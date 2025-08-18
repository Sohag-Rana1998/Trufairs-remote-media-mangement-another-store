const path = require("path");

// Validate file type
function isValidFileType(mimetype) {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/mov",
    "video/avi",
    "video/webm",
    "video/quicktime",
  ];
  return allowedTypes.includes(mimetype);
}

// Generate safe filename
function generateSafeFilename(originalName, sku) {
  const timestamp = Date.now();
  const extension = path.extname(originalName);
  const baseName = path.basename(originalName, extension);

  // Clean the filename
  const cleanBaseName = baseName.replace(/[^a-zA-Z0-9]/g, "_");
  const cleanSku = sku.replace(/[^a-zA-Z0-9]/g, "_");

  return `${cleanSku}_${cleanBaseName}_${timestamp}${extension}`;
}

// Get file size in MB
function getFileSizeInMB(sizeInBytes) {
  return (sizeInBytes / (1024 * 1024)).toFixed(2);
}

// Validate file size
function isValidFileSize(sizeInBytes, maxSizeInMB = 50) {
  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;
  return sizeInBytes <= maxSizeInBytes;
}

module.exports = {
  isValidFileType,
  generateSafeFilename,
  getFileSizeInMB,
  isValidFileSize,
};
