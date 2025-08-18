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

// Get product details with metafields (CORRECTED GraphQL)
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

    // Try to get media using GraphQL (CORRECTED QUERY)
    let mediaItems = [];
    try {
      console.log("Fetching media via GraphQL...");

      const mediaQuery = `
        query getProductMedia($id: ID!) {
          product(id: $id) {
            id
            media(first: 50) {
              edges {
                node {
                  id
                  mediaContentType
                  alt
                  ... on Video {
                    id
                    sources {
                      url
                      mimeType
                      format
                      height
                      width
                    }
                    originalSource {
                      url
                    }
                    preview {
                      image {
                        url
                      }
                    }
                  }
                  ... on MediaImage {
                    id
                    image {
                      url
                      altText
                    }
                  }
                  ... on ExternalVideo {
                    id
                    embedUrl
                    host
                    originUrl
                  }
                  ... on Model3d {
                    id
                    sources {
                      url
                      mimeType
                      format
                    }
                    originalSource {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const mediaResponse = await mainStore.makeGraphQLRequest(mediaQuery, {
        id: `gid://shopify/Product/${productId}`,
      });

      console.log("GraphQL media response received");

      // Process media data
      if (
        mediaResponse.data &&
        mediaResponse.data.product &&
        mediaResponse.data.product.media
      ) {
        mediaItems = mediaResponse.data.product.media.edges.map((edge) => {
          const node = edge.node;
          let processedMedia = {
            id: node.id,
            alt: node.alt,
            media_type: node.mediaContentType,
          };

          if (node.mediaContentType === "VIDEO" && node.sources) {
            processedMedia.sources = node.sources;
            processedMedia.original_source = node.originalSource;
            processedMedia.preview_image = node.preview?.image;
            console.log(`Found video media: ${node.id}`, processedMedia);
          } else if (node.mediaContentType === "IMAGE" && node.image) {
            processedMedia.image = node.image;
            console.log(`Found image media: ${node.id}`, processedMedia);
          } else if (node.mediaContentType === "EXTERNAL_VIDEO") {
            processedMedia.external_url = node.embedUrl || node.originUrl;
            processedMedia.host = node.host;
            console.log(`Found external video: ${node.id}`, processedMedia);
          } else if (node.mediaContentType === "MODEL_3D") {
            processedMedia.sources = node.sources;
            processedMedia.original_source = node.originalSource;
            console.log(`Found 3D model: ${node.id}`, processedMedia);
          }

          return processedMedia;
        });
      }

      console.log(`Found ${mediaItems.length} media items via GraphQL`);
    } catch (mediaError) {
      console.log("Could not fetch media via GraphQL:", mediaError.message);
      // Continue without media data - will fall back to images only
    }

    const product = {
      ...productData.product,
      metafields: processedMetafields,
      variants: variantsWithMetafields,
      media: mediaItems, // Add media items to product
    };

    console.log(`Successfully loaded product details for: ${product.title}`);
    console.log(
      `Product has ${product.images?.length || 0} images and ${
        mediaItems.length
      } media items`
    );

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

// Delete default product media (CORRECTED GraphQL)
router.delete("/:productId/delete-default-media", async (req, res) => {
  try {
    const { productId } = req.params;
    const { mediaUrl } = req.body;

    if (!mediaUrl || !productId) {
      return res.status(400).json({
        success: false,
        error: "mediaUrl and productId are required",
      });
    }

    console.log(
      `Deleting default media from product ${productId}: ${mediaUrl}`
    );

    let deletionResult = null;

    // First, try to delete from product images
    try {
      const imagesResponse = await mainStore.makeRequest(
        "GET",
        `/products/${productId}/images.json`
      );

      const matchingImage = imagesResponse.images.find(
        (image) => image.src === mediaUrl
      );

      if (matchingImage) {
        await mainStore.makeRequest(
          "DELETE",
          `/products/${productId}/images/${matchingImage.id}.json`
        );
        console.log(
          `Successfully deleted image ${matchingImage.id} from product ${productId}`
        );

        deletionResult = {
          success: true,
          message: "Image deleted successfully",
          imageId: matchingImage.id,
          type: "image",
        };
      }
    } catch (imageError) {
      console.log("Not found in product images, trying media...");
    }

    // If not found in images, try to delete from media using GraphQL
    if (!deletionResult) {
      try {
        // First, get all media to find the matching one (CORRECTED QUERY)
        const mediaQuery = `
          query getProductMedia($id: ID!) {
            product(id: $id) {
              media(first: 50) {
                edges {
                  node {
                    id
                    mediaContentType
                    ... on Video {
                      sources {
                        url
                      }
                      originalSource {
                        url
                      }
                    }
                    ... on MediaImage {
                      image {
                        url
                      }
                    }
                    ... on ExternalVideo {
                      embedUrl
                      originUrl
                    }
                    ... on Model3d {
                      sources {
                        url
                      }
                      originalSource {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        `;

        const mediaResponse = await mainStore.makeGraphQLRequest(mediaQuery, {
          id: `gid://shopify/Product/${productId}`,
        });

        let matchingMediaId = null;

        if (
          mediaResponse.data &&
          mediaResponse.data.product &&
          mediaResponse.data.product.media
        ) {
          for (const edge of mediaResponse.data.product.media.edges) {
            const node = edge.node;

            // Check various URL fields based on media type
            let urls = [];

            if (node.mediaContentType === "VIDEO") {
              urls = [
                ...(node.sources || []).map((s) => s.url),
                node.originalSource?.url,
              ].filter(Boolean);
            } else if (node.mediaContentType === "IMAGE") {
              urls = [node.image?.url].filter(Boolean);
            } else if (node.mediaContentType === "EXTERNAL_VIDEO") {
              urls = [node.embedUrl, node.originUrl].filter(Boolean);
            } else if (node.mediaContentType === "MODEL_3D") {
              urls = [
                ...(node.sources || []).map((s) => s.url),
                node.originalSource?.url,
              ].filter(Boolean);
            }

            if (urls.includes(mediaUrl)) {
              matchingMediaId = node.id;
              break;
            }
          }
        }

        if (matchingMediaId) {
          // Delete media using GraphQL
          const deleteMediaMutation = `
            mutation productDeleteMedia($mediaIds: [ID!]!, $productId: ID!) {
              productDeleteMedia(mediaIds: $mediaIds, productId: $productId) {
                deletedMediaIds
                deletedProductImageIds
                mediaUserErrors {
                  field
                  message
                }
                product {
                  id
                }
              }
            }
          `;

          const deleteResponse = await mainStore.makeGraphQLRequest(
            deleteMediaMutation,
            {
              mediaIds: [matchingMediaId],
              productId: `gid://shopify/Product/${productId}`,
            }
          );

          if (
            deleteResponse.data.productDeleteMedia.mediaUserErrors.length > 0
          ) {
            throw new Error(
              `Media deletion error: ${deleteResponse.data.productDeleteMedia.mediaUserErrors[0].message}`
            );
          }

          console.log(
            `Successfully deleted media ${matchingMediaId} from product ${productId}`
          );

          deletionResult = {
            success: true,
            message: "Media deleted successfully",
            mediaId: matchingMediaId,
            type: "media",
          };
        }
      } catch (mediaError) {
        console.error("Error deleting from media:", mediaError);
      }
    }

    if (deletionResult) {
      res.json(deletionResult);
    } else {
      res.status(404).json({
        success: false,
        error: "Media not found in product images or media",
      });
    }
  } catch (error) {
    console.error("Delete default media error:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    res.status(500).json({
      success: false,
      error: error.message || "Delete failed",
    });
  }
});

// Delete all default product media (CORRECTED GraphQL)
router.delete("/:productId/delete-all-default-media", async (req, res) => {
  try {
    const { productId } = req.params;

    console.log(`Deleting all default media from product ${productId}`);

    let deletedCount = 0;
    let failedCount = 0;
    const results = [];

    // Delete all product images
    try {
      const imagesResponse = await mainStore.makeRequest(
        "GET",
        `/products/${productId}/images.json`
      );

      for (const image of imagesResponse.images) {
        try {
          await mainStore.makeRequest(
            "DELETE",
            `/products/${productId}/images/${image.id}.json`
          );

          results.push({
            imageId: image.id,
            url: image.src,
            success: true,
            message: "Image deleted successfully",
            type: "image",
          });

          deletedCount++;
          console.log(`Deleted image ${image.id} from product ${productId}`);
        } catch (deleteError) {
          console.error(`Error deleting image ${image.id}:`, deleteError);

          results.push({
            imageId: image.id,
            url: image.src,
            success: false,
            error: deleteError.message,
            type: "image",
          });

          failedCount++;
        }
      }
    } catch (imagesError) {
      console.error("Error fetching product images:", imagesError);
    }

    // Delete all media using GraphQL (CORRECTED QUERY)
    try {
      const mediaQuery = `
        query getProductMedia($id: ID!) {
          product(id: $id) {
            media(first: 50) {
              edges {
                node {
                  id
                  mediaContentType
                }
              }
            }
          }
        }
      `;

      const mediaResponse = await mainStore.makeGraphQLRequest(mediaQuery, {
        id: `gid://shopify/Product/${productId}`,
      });

      if (
        mediaResponse.data &&
        mediaResponse.data.product &&
        mediaResponse.data.product.media
      ) {
        const mediaIds = mediaResponse.data.product.media.edges.map(
          (edge) => edge.node.id
        );

        if (mediaIds.length > 0) {
          const deleteMediaMutation = `
            mutation productDeleteMedia($mediaIds: [ID!]!, $productId: ID!) {
              productDeleteMedia(mediaIds: $mediaIds, productId: $productId) {
                deletedMediaIds
                deletedProductImageIds
                mediaUserErrors {
                  field
                  message
                }
              }
            }
          `;

          const deleteResponse = await mainStore.makeGraphQLRequest(
            deleteMediaMutation,
            {
              mediaIds: mediaIds,
              productId: `gid://shopify/Product/${productId}`,
            }
          );

          if (
            deleteResponse.data.productDeleteMedia.mediaUserErrors.length > 0
          ) {
            console.error(
              "Media deletion errors:",
              deleteResponse.data.productDeleteMedia.mediaUserErrors
            );
            failedCount += mediaIds.length;
          } else {
            const deletedMediaIds =
              deleteResponse.data.productDeleteMedia.deletedMediaIds || [];
            deletedCount += deletedMediaIds.length;

            deletedMediaIds.forEach((mediaId) => {
              results.push({
                mediaId: mediaId,
                success: true,
                message: "Media deleted successfully",
                type: "media",
              });
            });

            console.log(
              `Deleted ${deletedMediaIds.length} media            items from product ${productId}`
            );
          }
        }
      }
    } catch (mediaError) {
      console.error("Error deleting media:", mediaError);
    }

    res.json({
      success: failedCount === 0,
      message: `Bulk deletion completed: ${deletedCount} deleted, ${failedCount} failed`,
      deletedCount,
      failedCount,
      totalProcessed: results.length,
      results,
    });
  } catch (error) {
    console.error("Delete all default media error:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    res.status(500).json({
      success: false,
      error: error.message || "Delete all failed",
    });
  }
});

// Fetch metafield media for a product
router.get("/products/:productId/metafield-media", async (req, res) => {
  const { productId } = req.params;

  try {
    const metafieldsResponse = await externalStore.makeRequest(
      "GET",
      `/products/${productId}/metafields.json`
    );
    const metafieldMedia = metafieldsResponse.metafields.filter(
      (mf) => mf.namespace === "media_info"
    );

    // Map metafield media to a format suitable for the frontend
    const mediaList = metafieldMedia.map((mf) => ({
      id: mf.id,
      url: mf.value, // Assuming the value is the media URL
      alt: mf.key, // Use key or any other property for alt text
    }));

    res.json(mediaList);
  } catch (error) {
    console.error("Error fetching metafield media:", error);
    res.status(500).json({ error: "Failed to fetch metafield media." });
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
