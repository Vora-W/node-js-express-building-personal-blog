import "dotenv/config";

import express from "express";
import cors from "cors";
import connectionPool from "./utils/db.mjs";

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/test", (req, res) => {
  res.send("Hello TechUp!");
});

//node-js-express-building-personal-blog-assignment
app.get("/profiles", (req, res) => {
  return res.status(200).json({
    data: {
      name: "john",
      age: 20,
    },
  });
});

app.get("/test-db", async (req, res) => {
  try {
    const result = await connectionPool.query("SELECT NOW()");
    return res.json({
      message: "Database connection successful",
      timestamp: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database connection failed:", error);
    return res.status(500).json({
      error: "Database connection failed",
    });
  }
});

// node-js-build-creating-data-api-building-personal-blog-assignment
app.post("/posts", async (req, res) => {
  try {
    const newPost = {
      ...req.body,
      date: new Date(),
    };

    // Validate required fields before touching the database
    if (
      !newPost.title ||
      !newPost.image ||
      !newPost.category_id ||
      !newPost.description ||
      !newPost.content ||
      !newPost.status_id
    ) {
      return res.status(400).json({
        message:
          "Server could not create post because there are missing data from client",
      });
    }

    await connectionPool.query(
      `INSERT INTO posts (title, image, category_id, description, content, status_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newPost.title,
        newPost.image,
        newPost.category_id,
        newPost.description,
        newPost.content,
        newPost.status_id,
      ]
    );

    return res.status(201).json({ message: "Created post successfully" });

  } catch {
    return res.status(500).json({
      message: `Server could not create post because database connection`,
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
