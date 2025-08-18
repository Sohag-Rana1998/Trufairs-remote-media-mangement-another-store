const express = require("express");
const { mainStore } = require("../config/shopify");
const router = express.Router();

// Search products
router.get("/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
      });
    }

    console.log(`Searching for products with query: ${query}`);

    // Search by title
    const titleSearch = await mainStore.makeRequest(
      "GET",
      `/products.json?title=${encodeURIComponent(query)}&limit=50`
    );

    // Search by SKU (search in variants)
    const skuSearch = await mainStore.makeRequest(
      "GET",
      `/products.json?limit=250`
    );
    const skuFiltered = skuSearch.products.filter((product) =>
      product.variants.some(
        (variant) =>
          variant.sku && variant.sku.toLowerCase().includes(query.toLowerCase())
      )
    );

    // Combine and deduplicate results
    const allProducts = [...titleSearch.products, ...skuFiltered];
    const uniqueProducts = allProducts.filter(
      (product, index, self) =>
        index === self.findIndex((p) => p.id === product.id)
    );

    console.log(`Found ${uniqueProducts.length} products`);

    res.json({
      success: true,
      products: uniqueProducts.slice(0, 50), // Limit to 50 results
    });
  } catch (error) {
    console.error("Product search error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get product details with metafields
router.get("/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    console.log(`Getting product details for ID: ${productId}`);

    // Get product details
    const productData = await mainStore.makeRequest(
      "GET",
      `/products/${productId}.json`
    );

    // Get product metafields
    const metafields = await mainStore.makeRequest(
      "GET",
      `/products/${productId}/metafields.json`
    );

    // Process product metafields to parse JSON values
    const processedMetafields = metafields.metafields.map((metafield) => {
      if (
        metafield.namespace === "custom" &&
        (metafield.key === "media_url" || metafield.key === "thumbnail_images")
      ) {
        try {
          // Try to parse JSON value
          const parsedValue = JSON.parse(metafield.value);
          return {
            ...metafield,
            value: parsedValue,
          };
        } catch (parseError) {
          // If not JSON, return as is
          console.log(
            `Metafield ${metafield.key} is not JSON, returning as string`
          );
          return metafield;
        }
      }
      return metafield;
    });

    // Get variant metafields for each variant
    const variantsWithMetafields = await Promise.all(
      productData.product.variants.map(async (variant) => {
        try {
          const variantMetafields = await mainStore.makeRequest(
            "GET",
            `/variants/${variant.id}/metafields.json`
          );

          // Process variant metafields to parse JSON values
          const processedVariantMetafields = variantMetafields.metafields.map(
            (metafield) => {
              if (
                metafield.namespace === "custom" &&
                metafield.key === "variant_image"
              ) {
                try {
                  // Try to parse JSON value
                  const parsedValue = JSON.parse(metafield.value);
                  return {
                    ...metafield,
                    value: parsedValue,
                  };
                } catch (parseError) {
                  // If not JSON, return as is
                  return metafield;
                }
              }
              return metafield;
            }
          );

          return {
            ...variant,
            metafields: processedVariantMetafields,
          };
        } catch (error) {
          console.error(
            `Error fetching metafields for variant ${variant.id}:`,
            error
          );
          return {
            ...variant,
            metafields: [],
          };
        }
      })
    );

    const product = {
      ...productData.product,
      metafields: processedMetafields,
      variants: variantsWithMetafields,
    };

    console.log(`Successfully loaded product details for: ${product.title}`);

    res.json({
      success: true,
      product,
    });
  } catch (error) {
    console.error("Get product error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Update product thumbnail images (Multi-line JSON format)
router.put("/:productId/thumbnails", async (req, res) => {
  try {
    const { productId } = req.params;
    const { thumbnailUrls } = req.body;

    console.log(`Updating thumbnails for product ${productId}:`, thumbnailUrls);

    if (!Array.isArray(thumbnailUrls)) {
      return res.status(400).json({
        success: false,
        error: "thumbnailUrls must be an array",
      });
    }

    // Filter out empty URLs
    const validUrls = thumbnailUrls.filter((url) => url && url.trim() !== "");
    console.log("Valid URLs after filtering:", validUrls);

    // Find existing thumbnail metafield
    const metafields = await mainStore.makeRequest(
      "GET",
      `/products/${productId}/metafields.json`
    );
    const existingThumbnailMetafield = metafields.metafields.find(
      (mf) => mf.namespace === "custom" && mf.key === "thumbnail_images"
    );

    // Use multi_line_text_field with JSON string
    const metafieldData = {
      metafield: {
        namespace: "custom",
        key: "thumbnail_images",
        value: JSON.stringify(validUrls), // Store as JSON string
        type: "multi_line_text_field",
      },
    };

    console.log(
      "Metafield data to send:",
      JSON.stringify(metafieldData, null, 2)
    );

    let result;
    if (existingThumbnailMetafield) {
      // Update existing metafield
      console.log(
        `Updating existing thumbnail metafield ${existingThumbnailMetafield.id}`
      );
      result = await mainStore.makeRequest(
        "PUT",
        `/products/${productId}/metafields/${existingThumbnailMetafield.id}.json`,
        metafieldData
      );
      console.log("Updated existing thumbnail metafield");
    } else {
      // Create new metafield
      console.log("Creating new thumbnail metafield");
      result = await mainStore.makeRequest(
        "POST",
        `/products/${productId}/metafields.json`,
        metafieldData
      );
      console.log("Created new thumbnail metafield");
    }

    res.json({
      success: true,
      metafield: result.metafield,
      message: "Thumbnail images saved successfully",
    });
  } catch (error) {
    console.error("Save thumbnails error:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });

    // Extract meaningful error message
    let errorMessage = error.message;
    if (error.response?.data) {
      if (error.response.data.errors) {
        errorMessage =
          typeof error.response.data.errors === "object"
            ? JSON.stringify(error.response.data.errors)
            : error.response.data.errors;
      } else if (typeof error.response.data === "string") {
        errorMessage = error.response.data;
      } else {
        errorMessage = JSON.stringify(error.response.data);
      }
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

module.exports = router;
