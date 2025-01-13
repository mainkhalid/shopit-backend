require("dotenv").config();
const express = require("express"); 
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const cloudinary = require("./cloudinaryConfig");
const streamifier = require("streamifier");


const app = express();
const port = process.env.PORT || 4000;
const jwtSecret = process.env.JWT_SECRET || "default_secret";


// Middleware
app.use(express.json());
const allowedOrigins = [
  "https://shop-it-admin.onrender.com", // admin frontend
  "https://shop-it254.onrender.com",  // enduser url
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: "GET,POST,PUT,DELETE,OPTIONS",
    allowedHeaders: "Content-Type,Authorization",
    credentials: true,
  })
);



// Database Connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Error connecting to MongoDB:", err));

// Mongoose Schemas
const Product = mongoose.model("Product", {
  id: Number,
  name: String,
  image: String,
  imageVersion: { type: Number, default: 1 },
  category: String,
  new_price: Number,
  old_price: Number,
  date: { type: Date, default: Date.now },
  available: { type: Boolean, default: true },
  features: { type: [String], default: [] },
});

const Users = mongoose.model("Users", {
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  cartData: { type: Object },
  date: { type: Date, default: Date.now },
});
// Configure Multer to store images in memory
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Routes

// Default Route
app.get("/", (req, res) => res.send("Express app is running"));

// Upload Image and Create Product Endpoint
app.post("/upload", upload.single("product"), async (req, res) => {
  const { name, category, new_price, old_price, available, features } = req.body;

  if (!name || !category || !new_price) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: name, category, or new_price.",
    });
  }

  try {
    // Generate a new product ID
    const lastProduct = await Product.findOne().sort({ id: -1 });
    const newId = lastProduct ? lastProduct.id + 1 : 1;

    // Upload the image to Cloudinary
    let imageUrl = null;
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: "products", use_filename: true, unique_filename: false },
          (error, cloudinaryResult) => {
            if (error) {
              console.error("Cloudinary upload error:", error);
              return reject(error);
            }
            resolve(cloudinaryResult);
          }
        );
        streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
      });
      imageUrl = result.secure_url;
    }

    // Create a new product with the uploaded image
    const product = new Product({
      id: newId,
      name,
      image: imageUrl, // Cloudinary URL
      category,
      new_price,
      old_price: old_price || 0,
      available: available !== undefined ? available : true,
      features: features || [],
    });

    // Save the product to the database
    await product.save();

    console.log("Product saved successfully:", product);
    res.status(201).json({
      success: true,
      message: "Product added successfully.",
      product,
    });
  } catch (error) {
    console.error("Error adding product:", error);
    res.status(500).json({
      success: false,
      message: "Error adding product. Please try again later.",
    });
  }
});

//add product endpoint
app.post("/addproduct", async (req, res) => {
  try {
    const { name, image, category, new_price, old_price, available, features } = req.body;

    // Validate required fields
    if (!name || !image || !category || !new_price) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, image, category, or new_price.",
      });
    }

    // Validate and sanitize features (if provided)
    if (features && !Array.isArray(features)) {
      return res.status(400).json({
        success: false,
        message: "Features must be an array.",
      });
    }

    const lastProduct = await Product.findOne().sort({ id: -1 });
    const newId = lastProduct ? lastProduct.id + 1 : 1;

    // Create the product object
    const product = new Product({
      id: newId,
      name,
      image, // Cloudinary image URL
      category,
      new_price,
      old_price,
      available: available !== undefined ? available : true,
      features: features || [], // Store features (default to empty array if not provided)
    });

    // Save to the database
    await product.save();

    console.log("Product saved successfully:", product);
    res.status(201).json({
      success: true,
      message: "Product added successfully.",
      product,
    });
  } catch (error) {
    console.error("Error adding product:", error);
    res.status(500).json({
      success: false,
      message: "Error adding product. Please try again later.",
    });
  }
});


// Remove Product
app.post("/removeproduct", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required.",
      });
    }

    // Find the product by ID
    const product = await Product.findOne({ id });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    // Extract the Cloudinary public ID from the image URL
    const imageUrl = product.image;
    const urlParts = imageUrl.split('/');
    const filenameWithExtension = urlParts[urlParts.length - 1]; // Get the last part of the URL
    const publicId = filenameWithExtension.split('.')[0]; // Remove the file extension

    // Since images are stored in the "products" folder
    const cloudinaryPublicId = `products/${publicId}`; // Prepend the folder name

    // Delete the image from Cloudinary
    const cloudinaryResponse = await cloudinary.uploader.destroy(cloudinaryPublicId);

    if (cloudinaryResponse.result !== "ok" && cloudinaryResponse.result !== "not found") {
      console.error("Error deleting image from Cloudinary:", cloudinaryResponse);
      return res.status(500).json({
        success: false,
        message: "Error deleting image from Cloudinary.",
        cloudinaryResponse,
      });
    }

    // Remove the product from MongoDB
    await Product.findOneAndDelete({ id });
    console.log(`Product with ID ${id} removed successfully.`);

    res.status(200).json({
      success: true,
      message: "Product and image removed successfully.",
    });
  } catch (error) {
    console.error("Error removing product:", error);
    res.status(500).json({
      success: false,
      message: "Error removing product.",
      error: error.message,
    });
  }
});

// Get All Products
app.get("/allproducts", async (req, res) => {
  try {
    const products = await Product.find({});
    res.json(
      products.map((product) => ({
        ...product.toObject(),
        image: `${product.image}?v=${product.imageVersion}`, // Append version for cache busting
      }))
    );
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ success: false, message: "Error fetching products" });
  }
});

// User Signup
app.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await Users.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const cart = Array(300).fill(0);

    const user = new Users({
      name,
      email,
      password: hashedPassword,
      cartData: cart,
    });

    await user.save();

    const token = jwt.sign({ id: user.id }, jwtSecret);
    res.json({ success: true, token });
  } catch (error) {
    console.error("Error during signup:", error);
    res.status(500).json({ success: false, message: "Error during signup" });
  }
});

// User Login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Users.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, message: "User does not exist" });
    }

    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res.status(400).json({ success: false, message: "Incorrect password" });
    }

    const token = jwt.sign({ id: user.id }, jwtSecret);
    res.json({ success: true, token });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ success: false, message: "Error during login" });
  }
});

// Fetch New Collections
app.get("/newcollections", async (req, res) => {
  try {
    const newcollection = await Product.find({}).skip(1).limit(8);
    console.log("New collection fetched");
    res.json(newcollection);
  } catch (error) {
    console.error("Error fetching new collections:", error);
    res.status(500).json({ success: false, message: "Error fetching new collections" });
  }
});

// Fetch Popular Products
app.get("/popular", async (req, res) => {
  try {
    const popular = await Product.find({}).skip(1).limit(3);
    console.log("Popular products fetched");
    res.json(popular);
  } catch (error) {
    console.error("Error fetching popular products:", error);
    res.status(500).json({ success: false, message: "Error fetching popular products" });
  }
});


// Cleanup Script bfcz
const cleanupOrphans = async () => {
  const products = await Product.find({});
  const cloudinaryImages = await cloudinary.api.resources({ type: "upload", prefix: "products/" });

  const dbImageUrls = products.map((p) => p.image);
  const cloudinaryUrls = cloudinaryImages.resources.map((img) => img.secure_url);

  const orphanedImages = cloudinaryUrls.filter((url) => !dbImageUrls.includes(url));

  for (const orphan of orphanedImages) {
    const publicId = orphan.match(/\/products\/(.+)\./)[1];
    await cloudinary.uploader.destroy(publicId);
    console.log(`Deleted orphaned image: ${orphan}`);
  }
};
cleanupOrphans();


// Start the Server
app.listen(port, (error) => {
  if (!error) {
    console.log(`Server is running on http://localhost:${port}`);
  } else {
    console.error("Error starting server:", error);
  }
});
