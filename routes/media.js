const express = require("express");
const multer = require("multer");
const { mainStore, externalStore } = require("../config/shopify");
const router = express.Router();

// Configure multer for file uploads (Updated for videos)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB limit for videos
  },
  fileFilter: (req, file, cb) => {
    // Allow images and videos
    const allowedMimes = [
      // Images
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      // Videos
      "video/mp4",
      "video/mov",
      "video/avi",
      "video/webm",
      "video/quicktime",
      "video/mkv",
      "video/wmv",
      "video/flv",
      "video/m4v",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type: ${file.mimetype}. Only images and videos are allowed.`
        )
      );
    }
  },
});

// Upload media to external Shopify store (Separate handling for images and videos)
router.post("/upload-to-shopify", upload.single("file"), async (req, res) => {
  try {
    console.log("Upload request received");
    console.log("Body:", req.body);
    console.log("File:", req.file ? "File present" : "No file");

    const { sku, productId } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: "No file provided",
      });
    }

    if (!sku || !productId) {
      return res.status(400).json({
        success: false,
        error: "SKU and productId are required",
      });
    }

    const isVideo = file.mimetype.startsWith("video/");
    const isImage = file.mimetype.startsWith("image/");

    if (!isVideo && !isImage) {
      return res.status(400).json({
        success: false,
        error: "Only image and video files are supported",
      });
    }

    console.log(
      `Uploading ${isVideo ? "video" : "image"} to external Shopify store...`
    );

    // Get the product title from the main store for the alt tag
    const productData = await mainStore.makeRequest(
      "GET",
      `/products/${productId}.json`
    );
    const productTitle = productData.product.title;
    console.log("Product title for alt tag:", productTitle);

    let uploadResult;

    if (isVideo) {
      // Use GraphQL video upload with polling
      uploadResult = await uploadVideoToExternalStore(file, sku, productTitle);
    } else {
      // Use product images for images
      uploadResult = await uploadImageToExternalStore(file, sku, productTitle);
    }

    const mediaUrl = uploadResult.url;
    console.log(`File uploaded successfully: ${mediaUrl}`);

    // Update main store product metafields with new media URL
    await updateProductMediaMetafieldsJSON(productId, mediaUrl);

    res.json({
      success: true,
      media: {
        url: mediaUrl,
        secure_url: mediaUrl,
        public_id: uploadResult.id,
        resource_type: isVideo ? "video" : "image",
        filename: `${sku}_${Date.now()}.${file.originalname.split(".").pop()}`,
        alt: productTitle,
      },
      message: `${
        isVideo ? "Video" : "Image"
      } uploaded successfully. URL: "${mediaUrl}"`,
    });
  } catch (error) {
    console.error("Upload error details:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });

    let errorMessage = "Unknown error occurred";

    if (error.message) {
      errorMessage = error.message;
    } else if (error.response?.data) {
      if (typeof error.response.data === "string") {
        errorMessage = error.response.data;
      } else if (error.response.data.errors) {
        errorMessage = JSON.stringify(error.response.data.errors);
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

// Serve video files (Updated to handle chunks)
// router.get("/video/:productId", async (req, res) => {
//   try {
//     const { productId } = req.params;

//     console.log("Retrieving video for product:", productId);

//     // Get video product metafields
//     const metafields = await externalStore.makeRequest(
//       "GET",
//       `/products/${productId}/metafields.json`
//     );

//     // Find video info metafields
//     const chunkCountMetafield = metafields.metafields.find(
//       (mf) => mf.namespace === "video_info" && mf.key === "chunk_count"
//     );

//     const mimeTypeMetafield = metafields.metafields.find(
//       (mf) => mf.namespace === "video_info" && mf.key === "mime_type"
//     );

//     const filenameMetafield = metafields.metafields.find(
//       (mf) => mf.namespace === "video_info" && mf.key === "original_filename"
//     );

//     const fileSizeMetafield = metafields.metafields.find(
//       (mf) => mf.namespace === "video_info" && mf.key === "file_size"
//     );

//     if (!chunkCountMetafield) {
//       return res.status(404).json({
//         success: false,
//         error: "Video data not found",
//       });
//     }

//     const chunkCount = parseInt(chunkCountMetafield.value);
//     console.log(`Reconstructing video from ${chunkCount} chunks...`);

//     // Reconstruct video data from chunks
//     let base64Video = "";
//     for (let i = 0; i < chunkCount; i++) {
//       const chunkMetafield = metafields.metafields.find(
//         (mf) => mf.namespace === "video_data" && mf.key === `chunk_${i}`
//       );

//       if (chunkMetafield && chunkMetafield.value) {
//         base64Video += chunkMetafield.value;
//       } else {
//         return res.status(500).json({
//           success: false,
//           error: `Missing video chunk ${i}`,
//         });
//       }
//     }

//     // Convert base64 back to buffer
//     const videoBuffer = Buffer.from(base64Video, "base64");
//     const mimeType = mimeTypeMetafield ? mimeTypeMetafield.value : "video/mp4";
//     const filename = filenameMetafield ? filenameMetafield.value : "video.mp4";
//     const fileSize = fileSizeMetafield
//       ? parseInt(fileSizeMetafield.value)
//       : videoBuffer.length;

//     console.log("Video reconstructed successfully:", {
//       size: videoBuffer.length,
//       originalSize: fileSize,
//       mimeType: mimeType,
//     });

//     // Set appropriate headers
//     res.set({
//       "Content-Type": mimeType,
//       "Content-Length": videoBuffer.length,
//       "Content-Disposition": `inline; filename="${filename}"`,
//       "Accept-Ranges": "bytes",
//       "Cache-Control": "public, max-age=31536000",
//     });

//     // Send video data
//     res.send(videoBuffer);
//   } catch (error) {
//     console.error("Video retrieval error:", {
//       message: error.message,
//       response: error.response?.data,
//       status: error.response?.status,
//     });

//     res.status(500).json({
//       success: false,
//       error: `Failed to retrieve video: ${error.message}`,
//     });
//   }
// });

// Updated function to get proper video URLs
async function uploadFileToShopify(file, sku, productTitle) {
  try {
    const isVideo = file.mimetype.startsWith("video/");
    console.log(`Uploading ${isVideo ? "video" : "image"} using Files API...`);

    // Check file size limits
    const maxSize = isVideo ? 1024 * 1024 * 1024 : 20 * 1024 * 1024; // 1GB for videos, 20MB for images
    if (file.size > maxSize) {
      throw new Error(
        `File size too large. Maximum size is ${isVideo ? "1GB" : "20MB"}.`
      );
    }

    const timestamp = Date.now();
    const fileExtension = file.originalname.split(".").pop().toLowerCase();
    const filename = `${sku}_${timestamp}.${fileExtension}`;

    console.log("File details:", {
      size: file.size,
      mimetype: file.mimetype,
      filename: filename,
      type: isVideo ? "video" : "image",
    });

    // Step 1: Create staged upload
    const stagedUploadMutation = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const stagedUploadVariables = {
      input: [
        {
          filename: filename,
          mimeType: file.mimetype,
          resource: isVideo ? "VIDEO" : "IMAGE",
          fileSize: file.size.toString(),
          httpMethod: "POST",
        },
      ],
    };

    console.log("Creating staged upload...");

    const stagedUploadResponse = await externalStore.makeGraphQLRequest(
      stagedUploadMutation,
      stagedUploadVariables
    );

    if (stagedUploadResponse.data.stagedUploadsCreate.userErrors.length > 0) {
      const errors = stagedUploadResponse.data.stagedUploadsCreate.userErrors;
      throw new Error(
        `Staged upload error: ${errors.map((e) => e.message).join(", ")}`
      );
    }

    const stagedTarget =
      stagedUploadResponse.data.stagedUploadsCreate.stagedTargets[0];
    console.log("Staged upload created successfully");

    // Step 2: Upload file to staged URL
    console.log("Uploading file to staged URL...");

    const FormData = require("form-data");
    const axios = require("axios");
    const form = new FormData();

    // Add parameters from Shopify
    stagedTarget.parameters.forEach((param) => {
      form.append(param.name, param.value);
    });

    // Add the file
    form.append("file", file.buffer, {
      filename: filename,
      contentType: file.mimetype,
    });

    const uploadResponse = await axios.post(stagedTarget.url, form, {
      headers: {
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 600000, // 10 minutes timeout
    });

    console.log("File uploaded to staged URL successfully");

    // Step 3: Create file record in Shopify
    const createFileMutation = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            alt
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const createFileVariables = {
      files: [
        {
          originalSource: stagedTarget.resourceUrl,
          contentType: isVideo ? "VIDEO" : "IMAGE",
          alt: productTitle,
        },
      ],
    };

    console.log("Creating file record in Shopify...");

    const createFileResponse = await externalStore.makeGraphQLRequest(
      createFileMutation,
      createFileVariables
    );

    if (createFileResponse.data.fileCreate.userErrors.length > 0) {
      const errors = createFileResponse.data.fileCreate.userErrors;
      throw new Error(
        `File creation error: ${errors.map((e) => e.message).join(", ")}`
      );
    }

    const createdFile = createFileResponse.data.fileCreate.files[0];
    console.log("File created successfully:", createdFile.id);

    // Step 4: For videos, get the actual playable URL
    let fileUrl = null;

    if (isVideo) {
      // Wait a bit for video processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get video details with sources
      const getVideoQuery = `
        query getVideo($id: ID!) {
          node(id: $id) {
            ... on Video {
              id
              sources {
                url
                mimeType
                format
                height
                width
              }
              preview {
                image {
                  url
                }
              }
            }
          }
        }
      `;

      console.log("Fetching video sources...");

      const getVideoResponse = await externalStore.makeGraphQLRequest(
        getVideoQuery,
        {
          id: createdFile.id,
        }
      );

      const videoNode = getVideoResponse.data.node;

      if (videoNode && videoNode.sources && videoNode.sources.length > 0) {
        // Get the best quality source
        const bestSource =
          videoNode.sources.find((source) => source.format === "mp4") ||
          videoNode.sources[0];
        fileUrl = bestSource.url;
        console.log("Found video source URL:", fileUrl);
      } else {
        console.log("No video sources found, using resourceUrl");
        fileUrl = stagedTarget.resourceUrl;
      }
    } else {
      // For images, get the image URL
      const getImageQuery = `
        query getImage($id: ID!) {
          node(id: $id) {
            ... on MediaImage {
              id
              image {
                url
                altText
              }
            }
          }
        }
      `;

      console.log("Fetching image URL...");

      const getImageResponse = await externalStore.makeGraphQLRequest(
        getImageQuery,
        {
          id: createdFile.id,
        }
      );

      const imageNode = getImageResponse.data.node;

      if (imageNode && imageNode.image && imageNode.image.url) {
        fileUrl = imageNode.image.url;
        console.log("Found image URL:", fileUrl);
      } else {
        console.log("No image URL found, using resourceUrl");
        fileUrl = stagedTarget.resourceUrl;
      }
    }

    if (!fileUrl) {
      // Fallback: construct URL from resourceUrl
      fileUrl = stagedTarget.resourceUrl;
    }

    console.log("Final file URL:", fileUrl);

    return {
      id: createdFile.id,
      url: fileUrl,
      status: createdFile.fileStatus,
      alt: productTitle,
      type: isVideo ? "video" : "image",
    };
  } catch (error) {
    console.error("File upload error:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

// Upload image using product images (for images only)
async function uploadImageToExternalStore(file, sku, productTitle) {
  try {
    console.log("Uploading image using product images...");

    const timestamp = Date.now();
    const fileExtension = file.originalname.split(".").pop().toLowerCase();
    const filename = `${sku}_${timestamp}.${fileExtension}`;

    // Check file size
    if (file.size > 20 * 1024 * 1024) {
      // 20MB limit for images
      throw new Error("Image file size too large. Maximum size is 20MB.");
    }

    console.log("Image details:", {
      size: file.size,
      mimetype: file.mimetype,
      filename: filename,
    });

    // Create or get a dummy product for image storage
    const dummyProduct = await getOrCreateDummyProduct(
      `IMAGE_${sku}`,
      productTitle
    );
    console.log("Image storage product obtained:", dummyProduct.id);

    // Convert image to base64
    const base64Image = file.buffer.toString("base64");

    const imageData = {
      image: {
        attachment: base64Image,
        filename: filename,
        alt: `${productTitle} - ${file.originalname}`,
      },
    };

    console.log("Uploading image as product image...");

    const uploadResult = await externalStore.makeRequest(
      "POST",
      `/products/${dummyProduct.id}/images.json`,
      imageData
    );

    if (!uploadResult.image || !uploadResult.image.src) {
      throw new Error("Image upload failed - no URL returned");
    }

    const imageUrl = uploadResult.image.src;
    console.log(`Image uploaded successfully: ${imageUrl}`);

    return {
      id: uploadResult.image.id,
      url: imageUrl,
      status: "READY",
      alt: productTitle,
      type: "image",
      productId: dummyProduct.id,
    };
  } catch (error) {
    console.error("Image upload error:", error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
}

// Upload video using proper Shopify video flow with polling
async function uploadVideoToExternalStore(file, sku, productTitle) {
  try {
    console.log("Uploading video using proper Shopify video flow...");

    const timestamp = Date.now();
    const fileExtension = file.originalname.split(".").pop().toLowerCase();
    const filename = `${sku}_${timestamp}.${fileExtension}`;

    // Check file size
    if (file.size > 1024 * 1024 * 1024) {
      // 1GB limit
      throw new Error("Video file size too large. Maximum size is 1GB.");
    }

    console.log("Video details:", {
      size: file.size,
      mimetype: file.mimetype,
      filename: filename,
    });

    // Step 1: Create staged upload
    const stagedUploadMutation = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const stagedUploadVariables = {
      input: [
        {
          filename: filename,
          mimeType: file.mimetype,
          resource: "VIDEO",
          fileSize: file.size.toString(),
          httpMethod: "POST",
        },
      ],
    };

    console.log("Creating staged upload...");

    const stagedUploadResponse = await externalStore.makeGraphQLRequest(
      stagedUploadMutation,
      stagedUploadVariables
    );

    if (stagedUploadResponse.data.stagedUploadsCreate.userErrors.length > 0) {
      const errors = stagedUploadResponse.data.stagedUploadsCreate.userErrors;
      throw new Error(
        `Staged upload error: ${errors.map((e) => e.message).join(", ")}`
      );
    }

    const stagedTarget =
      stagedUploadResponse.data.stagedUploadsCreate.stagedTargets[0];
    console.log("Staged upload created successfully");

    // Step 2: Upload file to staged URL
    console.log("Uploading file to staged URL...");

    const FormData = require("form-data");
    const axios = require("axios");
    const form = new FormData();

    // Add parameters from Shopify in the correct order
    stagedTarget.parameters.forEach((param) => {
      form.append(param.name, param.value);
    });

    // Add the file
    form.append("file", file.buffer, {
      filename: filename,
      contentType: file.mimetype,
    });

    const uploadResponse = await axios.post(stagedTarget.url, form, {
      headers: {
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 600000, // 10 minutes timeout
    });

    console.log("File uploaded to staged URL successfully");

    // Step 3: Create file record
    const fileCreateMutation = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            alt
            fileStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const fileCreateVariables = {
      files: [
        {
          originalSource: stagedTarget.resourceUrl,
          contentType: "VIDEO",
          alt: productTitle,
        },
      ],
    };

    console.log("Creating file record in Shopify...");

    const fileCreateResponse = await externalStore.makeGraphQLRequest(
      fileCreateMutation,
      fileCreateVariables
    );

    if (fileCreateResponse.data.fileCreate.userErrors.length > 0) {
      const errors = fileCreateResponse.data.fileCreate.userErrors;
      throw new Error(
        `File creation error: ${errors.map((e) => e.message).join(", ")}`
      );
    }

    const createdFile = fileCreateResponse.data.fileCreate.files[0];
    console.log("File created successfully:", {
      id: createdFile.id,
      status: createdFile.fileStatus,
    });

    // Step 4: Poll for video processing completion
    console.log("Starting video processing polling...");
    const videoUrl = await pollForVideoProcessing(createdFile.id, 30); // Poll for up to 30 attempts (5 minutes)

    return {
      id: createdFile.id,
      url: videoUrl,
      status: "READY",
      alt: createdFile.alt,
      type: "video",
    };
  } catch (error) {
    console.error("Video upload error details:", {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });

    let errorMessage = "Unknown video upload error";

    if (error.message && error.message !== "[object Object]") {
      errorMessage = error.message;
    } else if (error.response?.data) {
      if (typeof error.response.data === "string") {
        errorMessage = error.response.data;
      } else if (error.response.data.errors) {
        errorMessage = JSON.stringify(error.response.data.errors);
      } else {
        errorMessage = JSON.stringify(error.response.data);
      }
    }

    throw new Error(`Failed to upload video: ${errorMessage}`);
  }
}

// Poll for video processing completion
async function pollForVideoProcessing(fileId, maxAttempts = 30) {
  console.log(
    `Polling for video processing completion (max ${maxAttempts} attempts)...`
  );

  const getVideoQuery = `
    query getVideo($id: ID!) {
      node(id: $id) {
        ... on Video {
          id
          fileStatus
          originalSource {
            url
          }
          sources {
            url
            format
            mimeType
            height
            width
          }
        }
      }
    }
  `;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Polling attempt ${attempt}/${maxAttempts}...`);

      const response = await externalStore.makeGraphQLRequest(getVideoQuery, {
        id: fileId,
      });

      const videoNode = response.data.node;

      if (videoNode) {
        console.log(`Video status: ${videoNode.fileStatus}`);

        if (videoNode.fileStatus === "READY") {
          // Video processing is complete
          let videoUrl = null;

          // Try to get the best URL
          if (videoNode.originalSource && videoNode.originalSource.url) {
            videoUrl = videoNode.originalSource.url;
            console.log("Found originalSource URL:", videoUrl);
          } else if (videoNode.sources && videoNode.sources.length > 0) {
            // Get the best quality source
            const mp4Source = videoNode.sources.find(
              (source) => source.format === "mp4"
            );
            const bestSource = mp4Source || videoNode.sources[0];
            videoUrl = bestSource.url;
            console.log("Found sources URL:", videoUrl);
            console.log("Available sources:", videoNode.sources);
          }

          if (videoUrl) {
            console.log(`Video processing completed! Final URL: ${videoUrl}`);
            return videoUrl;
          } else {
            console.log(
              "Video is ready but no URL found, continuing to poll..."
            );
          }
        } else if (videoNode.fileStatus === "FAILED") {
          throw new Error("Video processing failed");
        } else {
          console.log(
            `Video still processing (status: ${videoNode.fileStatus}), waiting...`
          );
        }
      } else {
        console.log("Video node not found, waiting...");
      }

      // Wait 10 seconds before next attempt
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    } catch (pollError) {
      console.error(`Polling attempt ${attempt} failed:`, pollError.message);

      // Wait before retrying
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }

  // If we get here, polling timed out
  throw new Error(
    `Video processing timed out after ${maxAttempts} attempts. The video may still be processing.`
  );
}

// Get or create a dummy product for hosting images
async function getOrCreateDummyProduct(sku, mainProductTitle) {
  try {
    console.log(`Getting or creating dummy product for SKU: ${sku}`);

    const productTitle = `${mainProductTitle}-${sku}`;

    // Check if dummy product already exists
    console.log("Searching for existing dummy product...");
    const searchResponse = await externalStore.makeRequest(
      "GET",
      `/products.json?limit=250`
    );

    const existingProduct = searchResponse.products.find(
      (product) =>
        product.title === productTitle ||
        product.title.includes(`Media Host ${sku}`)
    );

    if (existingProduct) {
      console.log("Using existing dummy product:", existingProduct.id);
      return existingProduct;
    }

    console.log("Creating new dummy product...");

    // Create new dummy product
    const productData = {
      product: {
        title: productTitle,
        body_html: `<p>Media hosting product for SKU: ${sku}</p>`,
        vendor: "Media Manager",
        product_type: "Media Host",
        status: "draft", // Keep it as draft so it's not visible
        published: false,
        variants: [
          {
            title: "Default",
            price: "0.00",
            sku: `MEDIA_HOST_${sku}_${Date.now()}`,
            inventory_management: null,
            inventory_policy: "continue",
            requires_shipping: false,
            taxable: false,
          },
        ],
      },
    };

    console.log(
      "Product data to create:",
      JSON.stringify(productData, null, 2)
    );

    const newProduct = await externalStore.makeRequest(
      "POST",
      "/products.json",
      productData
    );
    console.log("Created new dummy product:", newProduct.product.id);
    return newProduct.product;
  } catch (error) {
    console.error("Error creating/getting dummy product:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw new Error(`Failed to create/get dummy product: ${error.message}`);
  }
}

// Upload image to product
async function uploadImageToProduct(productId, file, sku, productTitle) {
  try {
    console.log(`Uploading image to product ${productId}...`);
    console.log("File details:", {
      size: file.size,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });

    // Check file size (Shopify has limits)
    if (file.size > 20 * 1024 * 1024) {
      // 20MB limit
      throw new Error("File size too large. Maximum size is 20MB.");
    }

    const base64Image = file.buffer.toString("base64");
    const fileExtension = file.originalname.split(".").pop().toLowerCase();

    // Validate file extension
    const allowedExtensions = ["jpg", "jpeg", "png", "gif", "webp"];
    if (!allowedExtensions.includes(fileExtension)) {
      throw new Error(
        `Invalid file extension: ${fileExtension}. Allowed: ${allowedExtensions.join(
          ", "
        )}`
      );
    }

    const filename = `${sku}_${Date.now()}.${fileExtension}`;

    const imageData = {
      image: {
        attachment: base64Image,
        filename: filename,
        alt: `${productTitle} (SKU: ${sku})`, // Product title with SKU in parentheses
      },
    };

    console.log("Uploading image with filename:", filename);

    const result = await externalStore.makeRequest(
      "POST",
      `/products/${productId}/images.json`,
      imageData
    );
    console.log("Image upload successful. Image ID:", result.image.id);
    return result;
  } catch (error) {
    console.error("Error uploading image to product:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw new Error(`Failed to upload image: ${error.message}`);
  }
}

// Alternative metafield function using JSON string format
async function updateProductMediaMetafieldsJSON(productId, newMediaUrl) {
  try {
    console.log(
      `Updating product ${productId} media metafields with URL: ${newMediaUrl}`
    );

    // Get existing metafields
    const metafieldsResponse = await mainStore.makeRequest(
      "GET",
      `/products/${productId}/metafields.json`
    );
    console.log(
      "Existing metafields found:",
      metafieldsResponse.metafields.length
    );

    const existingMediaMetafield = metafieldsResponse.metafields.find(
      (mf) => mf.namespace === "custom" && mf.key === "media_url"
    );

    let currentUrls = [];
    if (existingMediaMetafield && existingMediaMetafield.value) {
      console.log("Existing metafield value:", existingMediaMetafield.value);

      try {
        // Try to parse existing value as JSON
        const parsed = JSON.parse(existingMediaMetafield.value);
        currentUrls = Array.isArray(parsed) ? parsed : [parsed];
      } catch (parseError) {
        console.log("Existing value is not JSON, treating as single URL");
        currentUrls = [existingMediaMetafield.value];
      }
    }

    // Add new URL to the list
    currentUrls.push(newMediaUrl);
    console.log("Updated URLs array:", currentUrls);

    // Use multi_line_text_field with JSON string
    const metafieldData = {
      metafield: {
        namespace: "custom",
        key: "media_url",
        value: JSON.stringify(currentUrls),
        type: "multi_line_text_field",
      },
    };

    console.log(
      "Metafield data to send:",
      JSON.stringify(metafieldData, null, 2)
    );

    let result;
    if (existingMediaMetafield) {
      console.log(`Updating existing metafield ${existingMediaMetafield.id}`);
      result = await mainStore.makeRequest(
        "PUT",
        `/products/${productId}/metafields/${existingMediaMetafield.id}.json`,
        metafieldData
      );
    } else {
      console.log("Creating new metafield");
      result = await mainStore.makeRequest(
        "POST",
        `/products/${productId}/metafields.json`,
        metafieldData
      );
    }

    console.log("Metafield operation successful");
    return result;
  } catch (error) {
    console.error("Detailed metafield update error:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    throw new Error(
      `Failed to update metafields: ${error.message || "Unknown error"}`
    );
  }
}

// Delete media from external Shopify store
router.delete("/delete-from-shopify", async (req, res) => {
  try {
    console.log("Delete request received");
    console.log("Body:", req.body);

    const { mediaUrl, productId } = req.body;

    if (!mediaUrl || !productId) {
      return res.status(400).json({
        success: false,
        error: "mediaUrl and productId are required",
      });
    }

    // Extract image information from URL
    const imageInfo = extractImageInfoFromShopifyUrl(mediaUrl);
    console.log("Extracted image info:", imageInfo);

    if (imageInfo.imageId && imageInfo.productId) {
      try {
        // Delete image from external Shopify store
        console.log(
          `Attempting to delete image ${imageInfo.imageId} from product ${imageInfo.productId}`
        );
        await externalStore.makeRequest(
          "DELETE",
          `/products/${imageInfo.productId}/images/${imageInfo.imageId}.json`
        );
        console.log(
          `Image ${imageInfo.imageId} deleted successfully from external store`
        );
      } catch (deleteError) {
        console.error("Error deleting image from external store:", deleteError);
        // Continue with metafield update even if image deletion fails
      }
    } else {
      console.log(
        "Could not extract image info from URL, will only remove from metafields"
      );
    }

    // Remove URL from main store product metafields
    await removeMediaFromProductMetafields(productId, mediaUrl);

    res.json({
      success: true,
      message: "Media deleted successfully from external store and metafields",
    });
  } catch (error) {
    console.error("Delete error:", {
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

// Helper function to extract image and product ID from Shopify CDN URL
function extractImageInfoFromShopifyUrl(url) {
  try {
    console.log("Extracting info from URL:", url);

    // Parse the URL to extract the filename and timestamp
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const searchParams = urlObj.searchParams;

    // Extract the timestamp from the v parameter
    const timestamp = searchParams.get("v");
    console.log("Extracted timestamp:", timestamp);

    // Extract filename from path
    // URL format: /s/files/1/store_id/files/filename.ext
    const pathParts = pathname.split("/");
    const filename = pathParts[pathParts.length - 1];
    console.log("Extracted filename:", filename);

    if (timestamp && filename) {
      // The image ID in Shopify is typically the timestamp
      // The product ID needs to be found by searching for images with this filename
      return {
        imageId: timestamp,
        filename: filename,
        timestamp: timestamp,
        needsProductSearch: true,
      };
    }

    return {
      imageId: null,
      productId: null,
      filename: filename,
      timestamp: timestamp,
    };
  } catch (error) {
    console.error("Error extracting image info from URL:", error);
    return {
      imageId: null,
      productId: null,
      filename: null,
      timestamp: null,
    };
  }
}

// Updated delete function to handle GraphQL files
async function findAndDeleteMediaByUrl(mediaUrl) {
  try {
    console.log("Searching for media to delete:", mediaUrl);

    // Use GraphQL to search for files by URL
    const searchFilesQuery = `
      query {
        files(first: 250) {
          edges {
            node {
              id
              url
              fileStatus
            }
          }
        }
      }
    `;

    console.log("Searching files via GraphQL...");
    const filesResponse = await externalStore.makeGraphQLRequest(
      searchFilesQuery
    );

    if (filesResponse.data && filesResponse.data.files) {
      const matchingFile = filesResponse.data.files.edges.find((edge) => {
        const file = edge.node;
        return file.url === mediaUrl;
      });

      if (matchingFile) {
        console.log(`Found matching file ${matchingFile.node.id}`);

        // Delete using GraphQL
        const deleteFileMutation = `
          mutation fileDelete($input: [ID!]!) {
            fileDelete(fileIds: $input) {
              deletedFileIds
              userErrors {
                field
                message
              }
            }
          }
        `;

        const deleteResponse = await externalStore.makeGraphQLRequest(
          deleteFileMutation,
          {
            input: [matchingFile.node.id],
          }
        );

        if (deleteResponse.data.fileDelete.userErrors.length > 0) {
          throw new Error(
            `Delete error: ${deleteResponse.data.fileDelete.userErrors[0].message}`
          );
        }

        console.log(`Successfully deleted file ${matchingFile.node.id}`);

        return {
          success: true,
          fileId: matchingFile.node.id,
          type: "file",
        };
      }
    }

    // Fallback: search in product images if not found in files
    console.log(
      "File not found in GraphQL files, searching in product images..."
    );

    const productsResponse = await externalStore.makeRequest(
      "GET",
      "/products.json?limit=250"
    );

    for (const product of productsResponse.products) {
      try {
        const imagesResponse = await externalStore.makeRequest(
          "GET",
          `/products/${product.id}/images.json`
        );

        const matchingImage = imagesResponse.images.find(
          (image) =>
            image.src === mediaUrl ||
            image.src.includes(extractTimestampFromUrl(mediaUrl))
        );

        if (matchingImage) {
          console.log(
            `Found matching image ${matchingImage.id} in product ${product.id}`
          );

          await externalStore.makeRequest(
            "DELETE",
            `/products/${product.id}/images/${matchingImage.id}.json`
          );
          console.log(
            `Successfully deleted image ${matchingImage.id} from product ${product.id}`
          );

          return {
            success: true,
            imageId: matchingImage.id,
            productId: product.id,
            type: "image",
          };
        }
      } catch (imageError) {
        console.error(
          `Error checking images for product ${product.id}:`,
          imageError
        );
        continue;
      }
    }

    console.log("Media not found in external store");
    return {
      success: false,
      message: "Media not found in external store",
    };
  } catch (error) {
    console.error("Error finding and deleting media:", error);
    throw error;
  }
}

// Helper function to extract timestamp from URL
function extractTimestampFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get("v");
  } catch (error) {
    return null;
  }
}

// Updated delete route with comprehensive approach
router.delete("/delete-from-shopify", async (req, res) => {
  try {
    console.log("Delete request received");
    console.log("Body:", req.body);

    const { mediaUrl, productId } = req.body;

    if (!mediaUrl || !productId) {
      return res.status(400).json({
        success: false,
        error: "mediaUrl and productId are required",
      });
    }

    let deletionResult = { success: false };

    // Try to find and delete the image from external store
    try {
      deletionResult = await findAndDeleteMediaByUrl(mediaUrl);
      if (deletionResult.success) {
        console.log("Image deleted successfully from external store");
      } else {
        console.log(
          "Image not found in external store, continuing with metafield cleanup"
        );
      }
    } catch (deleteError) {
      console.error("Error deleting from external store:", deleteError);
      // Continue with metafield update even if deletion fails
    }

    // Always remove URL from main store product metafields
    await removeMediaFromProductMetafields(productId, mediaUrl);

    res.json({
      success: true,
      message: deletionResult.success
        ? "Media deleted successfully from external store and metafields"
        : "Media removed from metafields (not found in external store)",
      externalStoreDeletion: deletionResult.success,
    });
  } catch (error) {
    console.error("Delete error:", {
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

// Update the removeMediaFromProductMetafields to use JSON format
async function removeMediaFromProductMetafields(productId, mediaUrlToRemove) {
  try {
    console.log(
      `Removing media URL from product ${productId}: ${mediaUrlToRemove}`
    );

    // Get existing metafields
    const metafields = await mainStore.makeRequest(
      "GET",
      `/products/${productId}/metafields.json`
    );
    const existingMediaMetafield = metafields.metafields.find(
      (mf) => mf.namespace === "custom" && mf.key === "media_url"
    );

    if (!existingMediaMetafield || !existingMediaMetafield.value) {
      console.log("No existing media metafield found");
      return;
    }

    let currentUrls = [];
    if (Array.isArray(existingMediaMetafield.value)) {
      currentUrls = existingMediaMetafield.value;
    } else if (typeof existingMediaMetafield.value === "string") {
      try {
        currentUrls = JSON.parse(existingMediaMetafield.value);
      } catch (parseError) {
        console.error("Error parsing existing media URLs:", parseError);
        currentUrls = [existingMediaMetafield.value];
      }
    }

    // Remove the URL from the list
    const updatedUrls = currentUrls.filter((url) => url !== mediaUrlToRemove);

    const metafieldData = {
      metafield: {
        namespace: "custom",
        key: "media_url",
        value: JSON.stringify(updatedUrls), // Use JSON string format
        type: "multi_line_text_field",
      },
    };

    // Update the metafield
    await mainStore.makeRequest(
      "PUT",
      `/products/${productId}/metafields/${existingMediaMetafield.id}.json`,
      metafieldData
    );

    console.log(
      `Successfully removed media URL from product ${productId} metafields`
    );
  } catch (error) {
    console.error("Error removing media from product metafields:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw new Error(`Failed to remove from metafields: ${error.message}`);
  }
}

// Delete all media from external Shopify store
router.delete("/delete-all-from-shopify", async (req, res) => {
  try {
    console.log("Delete all request received");
    console.log("Body:", req.body);

    const { productId, mediaUrls } = req.body;

    if (!productId || !Array.isArray(mediaUrls)) {
      return res.status(400).json({
        success: false,
        error: "productId and mediaUrls array are required",
      });
    }

    if (mediaUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No media URLs provided",
      });
    }

    console.log(
      `Deleting ${mediaUrls.length} media files for product ${productId}`
    );

    let deletedCount = 0;
    let failedCount = 0;
    const results = [];

    // Delete each media file
    for (const mediaUrl of mediaUrls) {
      try {
        console.log(`Attempting to delete: ${mediaUrl}`);

        // Try to find and delete the image from external store
        const deletionResult = await findAndDeleteMediaByUrl(mediaUrl);

        results.push({
          url: mediaUrl,
          success: deletionResult.success,
          message: deletionResult.success
            ? "Deleted from external store"
            : "Not found in external store",
        });

        if (deletionResult.success) {
          deletedCount++;
        } else {
          failedCount++;
        }
      } catch (deleteError) {
        console.error(`Error deleting ${mediaUrl}:`, deleteError);
        results.push({
          url: mediaUrl,
          success: false,
          error: deleteError.message,
        });
        failedCount++;
      }
    }

    // Clear all media URLs from metafields
    try {
      await clearAllMediaFromProductMetafields(productId);
      console.log("Cleared all media URLs from metafields");
    } catch (metafieldError) {
      console.error("Error clearing metafields:", metafieldError);
      // Don't fail the entire operation if metafield clearing fails
    }

    res.json({
      success: true,
      message: `Bulk deletion completed: ${deletedCount} deleted, ${failedCount} failed`,
      deletedCount,
      failedCount,
      totalProcessed: mediaUrls.length,
      results,
    });
  } catch (error) {
    console.error("Delete all error:", {
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

// Helper function to clear all media URLs from metafields
async function clearAllMediaFromProductMetafields(productId) {
  try {
    console.log(`Clearing all media URLs from product ${productId} metafields`);

    // Get existing metafields
    const metafields = await mainStore.makeRequest(
      "GET",
      `/products/${productId}/metafields.json`
    );
    const existingMediaMetafield = metafields.metafields.find(
      (mf) => mf.namespace === "custom" && mf.key === "media_url"
    );

    if (!existingMediaMetafield) {
      console.log("No existing media metafield found");
      return;
    }

    // Set empty array
    const metafieldData = {
      metafield: {
        namespace: "custom",
        key: "media_url",
        value: JSON.stringify([]), // Empty array
        type: "multi_line_text_field",
      },
    };

    // Update the metafield
    await mainStore.makeRequest(
      "PUT",
      `/products/${productId}/metafields/${existingMediaMetafield.id}.json`,
      metafieldData
    );

    console.log(
      `Successfully cleared all media URLs from product ${productId} metafields`
    );
  } catch (error) {
    console.error("Error clearing media from product metafields:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw new Error(`Failed to clear metafields: ${error.message}`);
  }
}

module.exports = router;
