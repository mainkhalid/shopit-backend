const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { v2: cloudinary } = require("cloudinaryConfig");
require("dotenv").config(); // For environment variables

const app = express();
const port = process.env.PORT || 4000;
const jwtSecret = process.env.JWT_SECRET || "default_secret";

// Middleware
app.use(express.json());
app.use(cors());


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
  category: String,
  new_price: Number,
  old_price: Number,
  date: { type: Date, default: Date.now },
  available: { type: Boolean, default: true },
});

const Users = mongoose.model("Users", {
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  cartData: { type: Object },
  date: { type: Date, default: Date.now },
});

// Routes

// Default Route
app.get("/", (req, res) => res.send("Express app is running"));

// Upload Image Endpoint
app.post("/upload", multer().single("product"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  try {
    // Upload file to Cloudinary
    const result = await cloudinary.uploader.upload_stream({
      folder: "products",
      use_filename: true,
      unique_filename: false,
    });
    res.json({
      success: true,
      image_url: result.secure_url, // Cloudinary URL
    });
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error);
    res.status(500).json({ success: false, message: "Error uploading image" });
  }
});

// Add Product
app.post("/addproduct", async (req, res) => {
  try {
    const lastProduct = await Product.findOne().sort({ id: -1 });
    const newId = lastProduct ? lastProduct.id + 1 : 1;

    const product = new Product({
      id: newId,
      name: req.body.name,
      image: req.body.image, // Cloudinary URL from the upload response
      category: req.body.category,
      new_price: req.body.new_price,
      old_price: req.body.old_price,
      available: req.body.available,
    });

    await product.save();
    console.log("Product saved");
    res.json({ success: true, name: req.body.name });
  } catch (error) {
    console.error("Error saving product:", error);
    res.status(500).json({ success: false, message: "Error saving product" });
  }
});

// Remove Product
app.post("/removeproduct", async (req, res) => {
  try {
    await Product.findOneAndDelete({ id: req.body.id });
    console.log("Product removed");
    res.json({ success: true });
  } catch (error) {
    console.error("Error removing product:", error);
    res.status(500).json({ success: false, message: "Error removing product" });
  }
});

// Get All Products
app.get("/allproducts", async (req, res) => {
  try {
    const products = await Product.find({});
    console.log("All products fetched");
    res.json(products);
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

//update existing products
const updateProductImages = async () => {
  try {
    const products = await Product.find({});

    for (let product of products) {
      if (product.image.startsWith("http://localhost:4000/images/")) {
        const localPath = product.image.replace("http://localhost:4000/", "./");
        
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(localPath, {
          folder: "products",
          use_filename: true,
          unique_filename: false,
        });

        // Update the product with the Cloudinary URL
        product.image = result.secure_url;
        await product.save();

        // Delete the local file
        await fs.promises.unlink(localPath);

        console.log(`Updated product ${product.id} with Cloudinary URL.`);
      }
    }
  } catch (error) {
    console.error("Error updating product images:", error);
  }
};

updateProductImages();


// Start the Server
app.listen(port, (error) => {
  if (!error) {
    console.log(`Server is running on http://localhost:${port}`);
  } else {
    console.error("Error starting server:", error);
  }
});
