const express = require("express");
const { mainStore } = require("../config/shopify");
const router = express.Router();

// Update variant image
router.put("/:variantId/image", async (req, res) => {
  try {
    const { variantId } = req.params;
    const { imageUrl } = req.body;

    // Get existing variant metafields
    const metafields = await mainStore.makeRequest(
      "GET",
      `/variants/${variantId}/metafields.json`
    );
    const existingImageMetafield = metafields.metafields.find(
      (mf) => mf.namespace === "custom" && mf.key === "variant_image"
    );

    let result;
    let action;

    if (!imageUrl || imageUrl.trim() === "") {
      // Delete the metafield if imageUrl is empty
      if (existingImageMetafield) {
        await mainStore.makeRequest(
          "DELETE",
          `/variants/${variantId}/metafields/${existingImageMetafield.id}.json`
        );
        action = "deleted";
        result = { message: "Variant image removed" };
      } else {
        action = "no_change";
        result = { message: "No image to remove" };
      }
    } else {
      // Update or create the metafield
      const metafieldData = {
        metafield: {
          namespace: "custom",
          key: "variant_image",
          value: imageUrl,
          type: "single_line_text_field",
        },
      };

      if (existingImageMetafield) {
        // Update existing metafield
        const updateResult = await mainStore.makeRequest(
          "PUT",
          `/variants/${variantId}/metafields/${existingImageMetafield.id}.json`,
          metafieldData
        );
        result = updateResult;
        action = "updated";
      } else {
        // Create new metafield
        const createResult = await mainStore.makeRequest(
          "POST",
          `/variants/${variantId}/metafields.json`,
          metafieldData
        );
        result = createResult;
        action = "created";
      }
    }

    res.json({
      success: true,
      action: action,
      metafield: result.metafield || null,
      message: `Variant image ${action} successfully`,
    });
  } catch (error) {
    console.error("Update variant image error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get variant details with metafields
router.get("/:variantId", async (req, res) => {
  try {
    const { variantId } = req.params;

    // Get variant details
    const variantData = await mainStore.makeRequest(
      "GET",
      `/variants/${variantId}.json`
    );

    // Get variant metafields
    const metafields = await mainStore.makeRequest(
      "GET",
      `/variants/${variantId}/metafields.json`
    );

    const variant = {
      ...variantData.variant,
      metafields: metafields.metafields,
    };

    res.json({
      success: true,
      variant,
    });
  } catch (error) {
    console.error("Get variant error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Bulk update variant images
router.put("/bulk/images", async (req, res) => {
  try {
    const { variantUpdates } = req.body;

    if (!Array.isArray(variantUpdates)) {
      return res.status(400).json({
        success: false,
        error: "variantUpdates must be an array",
      });
    }

    const results = [];

    for (const update of variantUpdates) {
      try {
        const { variantId, imageUrl } = update;

        // Get existing variant metafields
        const metafields = await mainStore.makeRequest(
          "GET",
          `/variants/${variantId}/metafields.json`
        );
        const existingImageMetafield = metafields.metafields.find(
          (mf) => mf.namespace === "custom" && mf.key === "variant_image"
        );

        let result;
        let action;

        if (!imageUrl || imageUrl.trim() === "") {
          // Delete the metafield if imageUrl is empty
          if (existingImageMetafield) {
            await mainStore.makeRequest(
              "DELETE",
              `/variants/${variantId}/metafields/${existingImageMetafield.id}.json`
            );
            action = "deleted";
            result = { message: "Variant image removed" };
          } else {
            action = "no_change";
            result = { message: "No image to remove" };
          }
        } else {
          // Update or create the metafield
          const metafieldData = {
            metafield: {
              namespace: "custom",
              key: "variant_image",
              value: imageUrl,
              type: "single_line_text_field",
            },
          };

          if (existingImageMetafield) {
            // Update existing metafield
            const updateResult = await mainStore.makeRequest(
              "PUT",
              `/variants/${variantId}/metafields/${existingImageMetafield.id}.json`,
              metafieldData
            );
            result = updateResult;
            action = "updated";
          } else {
            // Create new metafield
            const createResult = await mainStore.makeRequest(
              "POST",
              `/variants/${variantId}/metafields.json`,
              metafieldData
            );
            result = createResult;
            action = "created";
          }
        }

        results.push({
          variantId,
          success: true,
          action,
          metafield: result.metafield || null,
        });
      } catch (error) {
        console.error(`Error updating variant ${update.variantId}:`, error);
        results.push({
          variantId: update.variantId,
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    res.json({
      success: failureCount === 0,
      results,
      summary: {
        total: variantUpdates.length,
        successful: successCount,
        failed: failureCount,
      },
      message: `Bulk update completed: ${successCount} successful, ${failureCount} failed`,
    });
  } catch (error) {
    console.error("Bulk update variant images error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
