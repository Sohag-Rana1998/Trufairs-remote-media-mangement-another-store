const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const productRoutes = require("./routes/products");
const mediaRoutes = require("./routes/media");
const variantRoutes = require("./routes/variants");

const app = express();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
});

const allowedOrigins = ["http://localhost:5173", "https://trufairs.com"];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true); // allow the request
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));

// Security middleware
app.use(helmet());

// Rate limiting
app.use("/api/", limiter);

// Body parsing
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Shopify Media Manager Backend",
  });
});

// API routes
app.use("/api/products", productRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/variants", variantRoutes);

// Redirect root to health
app.get("/", (req, res) => {
  res.redirect("/health");
});

// Error handling
app.use((error, req, res, next) => {
  console.error("Error:", error);
  res.status(500).json({
    success: false,
    error:
      process.env.NODE_ENV === "development"
        ? error.message
        : "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

// ❌ REMOVE app.listen() for Vercel
// ✅ Just export app
module.exports = app;
