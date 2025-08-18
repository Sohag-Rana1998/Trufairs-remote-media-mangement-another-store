const axios = require("axios");

class ShopifyAPI {
  constructor(storeUrl, accessToken) {
    this.storeUrl = storeUrl;
    this.accessToken = accessToken;
    this.baseURL = `https://${storeUrl}/admin/api/2023-10`;
    this.graphqlURL = `https://${storeUrl}/admin/api/2023-10/graphql.json`;
  }

  async makeRequest(method, endpoint, data = null) {
    try {
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          "X-Shopify-Access-Token": this.accessToken,
          "Content-Type": "application/json",
        },
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error(`Shopify API Error (${method} ${endpoint}):`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText,
      });

      let errorMessage = error.message;
      if (error.response?.data) {
        if (error.response.data.errors) {
          errorMessage =
            typeof error.response.data.errors === "object"
              ? JSON.stringify(error.response.data.errors)
              : error.response.data.errors;
        } else if (typeof error.response.data === "string") {
          errorMessage = error.response.data;
        }
      }

      throw new Error(errorMessage);
    }
  }

  // GraphQL method for file operations
  async makeGraphQLRequest(query, variables = {}) {
    try {
      const response = await axios.post(
        this.graphqlURL,
        {
          query: query,
          variables: variables,
        },
        {
          headers: {
            "X-Shopify-Access-Token": this.accessToken,
            "Content-Type": "application/json",
          },
          timeout: 300000, // 5 minutes timeout for large files
        }
      );

      if (response.data.errors) {
        throw new Error(
          `GraphQL Error: ${JSON.stringify(response.data.errors)}`
        );
      }

      return response.data;
    } catch (error) {
      console.error("Shopify GraphQL Error:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      throw error;
    }
  }
}

// Main store instance (for product management)
const mainStore = new ShopifyAPI(
  process.env.MAIN_SHOPIFY_STORE_URL,
  process.env.MAIN_SHOPIFY_ACCESS_TOKEN
);

// External store instance (for media uploads)
const externalStore = new ShopifyAPI(
  process.env.EXTERNAL_SHOPIFY_STORE_URL,
  process.env.EXTERNAL_SHOPIFY_ACCESS_TOKEN
);

module.exports = {
  mainStore,
  externalStore,
  ShopifyAPI,
};
