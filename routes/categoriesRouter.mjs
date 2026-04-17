import { Router } from "express";
import connectionPool from "../utils/db.mjs";
import protectAdmin from "../middleware/protectAdmin.mjs";

const categoriesRouter = Router();

categoriesRouter.get("/", protectAdmin, async (req, res) => {
  try {
    const { rows } = await connectionPool.query(
      "SELECT id, name FROM categories ORDER BY name ASC",
    );
    return res.status(200).json({ categories: rows });
  } catch (error) {
    return res.status(500).json({
      error: "Server could not load categories because database connection",
    });
  }
});

categoriesRouter.post("/", protectAdmin, async (req, res) => {
  const name = req.body.name?.trim();
  if (!name) {
    return res.status(400).json({ error: "Category name is required" });
  }

  try {
    const { rows } = await connectionPool.query(
      "INSERT INTO categories (name) VALUES ($1) RETURNING id, name",
      [name],
    );
    return res.status(201).json({
      message: "Created category successfully",
      category: rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({ error: "Category already exists" });
    }
    return res.status(500).json({
      error: "Server could not create category because database connection",
    });
  }
});

categoriesRouter.put("/:categoryId", protectAdmin, async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  const name = req.body.name?.trim();

  if (!Number.isInteger(categoryId)) {
    return res.status(400).json({ error: "Category ID must be a number" });
  }

  if (!name) {
    return res.status(400).json({ error: "Category name is required" });
  }

  try {
    const { rows, rowCount } = await connectionPool.query(
      "UPDATE categories SET name = $1 WHERE id = $2 RETURNING id, name",
      [name, categoryId],
    );

    if (!rowCount) {
      return res.status(404).json({ error: "Category not found" });
    }

    return res.status(200).json({
      message: "Updated category successfully",
      category: rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({ error: "Category already exists" });
    }
    return res.status(500).json({
      error: "Server could not update category because database connection",
    });
  }
});

categoriesRouter.delete("/:categoryId", protectAdmin, async (req, res) => {
  const categoryId = Number(req.params.categoryId);
  if (!Number.isInteger(categoryId)) {
    return res.status(400).json({ error: "Category ID must be a number" });
  }

  try {
    const result = await connectionPool.query(
      "DELETE FROM categories WHERE id = $1",
      [categoryId],
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Category not found" });
    }

    return res.status(200).json({ message: "Deleted category successfully" });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(400).json({
        error: "This category is still used by existing articles",
      });
    }
    return res.status(500).json({
      error: "Server could not delete category because database connection",
    });
  }
});

export default categoriesRouter;
