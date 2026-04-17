import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import connectionPool from "../utils/db.mjs";
import protectAdmin from "../middleware/protectAdmin.mjs";
import protectUser from "../middleware/protectUser.mjs";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);
const authRouter = Router();
const multerUpload = multer({ storage: multer.memoryStorage() });
const profileImageUpload = multerUpload.fields([
  { name: "profileImageFile", maxCount: 1 },
]);
const profileBucketName = "voranat-w-labs";

const sanitizeFileName = (fileName) =>
  fileName.replaceAll(/[^a-zA-Z0-9._-]/g, "_");

const uploadProfileImageIfPresent = async (req, res, next) => {
  const uploadedFile = req.files?.profileImageFile?.[0];
  if (!uploadedFile) {
    return next();
  }

  try {
    const filePath = `profiles/${req.user.id}_${Date.now()}_${sanitizeFileName(
      uploadedFile.originalname,
    )}`;
    const { data, error } = await supabase.storage
      .from(profileBucketName)
      .upload(filePath, uploadedFile.buffer, {
        contentType: uploadedFile.mimetype,
        upsert: false,
      });

    if (error) {
      return res.status(500).json({
        error: "Server could not upload profile image",
        message: error.message,
      });
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(profileBucketName).getPublicUrl(data.path);

    req.body.profilePic = publicUrl;
    return next();
  } catch (error) {
    return res.status(500).json({
      error: "Server could not upload profile image",
      message: error.message,
    });
  }
};

const getUserProfileById = async (userId) => {
  const query = `
    SELECT * FROM users
    WHERE id = $1
  `;
  const values = [userId];
  const { rows } = await connectionPool.query(query, values);

  return rows[0];
};

const serializeProfile = (authUser, profile) => ({
  id: authUser.id,
  email: authUser.email,
  username: profile.username,
  name: profile.name,
  role: profile.role,
  profilePic: profile.profile_pic,
});

const updatePasswordWithCurrentSession = async ({
  email,
  oldPassword,
  newPassword,
}) => {
  if (!newPassword) {
    throw new Error("New password is required");
  }

  const { error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password: oldPassword,
  });

  if (loginError) {
    throw new Error("Invalid old password");
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    throw new Error(error.message);
  }
};

// Register route
authRouter.post("/register", async (req, res) => {
    const { email, password, username, name } = req.body;
    try {
      const usernameCheckQuery = `
        SELECT * FROM users
        WHERE username = $1
      `;
      const usernameCheckValues = [username];
      const { rows: existingUser } = await connectionPool.query(
        usernameCheckQuery,
        usernameCheckValues
      );
      if (existingUser.length > 0) {
        return res.status(400).json({ error: "This username is already taken" });
      }
  
      const { data, error: supabaseError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (supabaseError) {
        if (supabaseError.code === "user_already_exists") {
          return res
            .status(400)
            .json({ error: "User with this email already exists" });
        }
        return res
          .status(400)
          .json({ error: "Failed to create user. Please try again." });
      }
  
      const supabaseUserId = data.user.id;
      const query = `
        INSERT INTO users (id, username, name, role)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
      const values = [supabaseUserId, username, name, "user"];
      const { rows } = await connectionPool.query(query, values);
      res.status(201).json({
        message: "User created successfully",
        user: rows[0],
      });
    } catch (error) {
      res.status(500).json({ error: "An error occurred during registration" });
    }
  });

// Login route
authRouter.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        if (
          error.code === "invalid_credentials" ||
          error.message.includes("Invalid login credentials")
        ) {
          return res.status(400).json({
            error: "Your password is incorrect or this email doesn't exist",
          });
        }
        return res.status(400).json({ error: error.message });
      }
      return res.status(200).json({
        message: "Signed in successfully",
        access_token: data.session.access_token,
      });
    } catch (error) {
      return res.status(500).json({ error: "An error occurred during login" });
    }
  });

  // Get user route
  authRouter.get("/get-user", protectUser, async (req, res) => {
    try {
      const profile = await getUserProfileById(req.user.id);
      if (!profile) {
        return res.status(404).json({ error: "User not found" });
      }
      res.status(200).json(serializeProfile(req.user, profile));
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  authRouter.get("/get-admin", protectAdmin, async (req, res) => {
    try {
      const profile = await getUserProfileById(req.user.id);
      if (!profile) {
        return res.status(404).json({ error: "User not found" });
      }
      res.status(200).json(serializeProfile(req.user, profile));
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  authRouter.put(
    "/profile",
    protectUser,
    profileImageUpload,
    uploadProfileImageIfPresent,
    async (req, res) => {
    const name = req.body.name?.trim();
    const username = req.body.username?.trim();
    const profilePic = req.body.profilePic ?? null;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    try {
      const usernameCheckQuery = `
        SELECT id FROM users
        WHERE username = $1 AND id <> $2
      `;
      const usernameCheckValues = [username, req.user.id];
      const { rows: existingUser } = await connectionPool.query(
        usernameCheckQuery,
        usernameCheckValues,
      );

      if (existingUser.length > 0) {
        return res.status(400).json({ error: "This username is already taken" });
      }

      const updateQuery = `
        UPDATE users
        SET username = $1, name = $2, profile_pic = $3
        WHERE id = $4
        RETURNING *
      `;
      const updateValues = [username, name, profilePic, req.user.id];
      const { rows, rowCount } = await connectionPool.query(
        updateQuery,
        updateValues,
      );

      if (!rowCount) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.status(200).json({
        message: "Profile updated successfully",
        user: serializeProfile(req.user, rows[0]),
      });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
    },
  );

  authRouter.put(
    "/admin/profile",
    protectAdmin,
    profileImageUpload,
    uploadProfileImageIfPresent,
    async (req, res) => {
    const name = req.body.name?.trim();
    const username = req.body.username?.trim();
    const profilePic = req.body.profilePic ?? null;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    try {
      const usernameCheckQuery = `
        SELECT id FROM users
        WHERE username = $1 AND id <> $2
      `;
      const usernameCheckValues = [username, req.user.id];
      const { rows: existingUser } = await connectionPool.query(
        usernameCheckQuery,
        usernameCheckValues,
      );

      if (existingUser.length > 0) {
        return res.status(400).json({ error: "This username is already taken" });
      }

      const updateQuery = `
        UPDATE users
        SET username = $1, name = $2, profile_pic = $3
        WHERE id = $4
        RETURNING *
      `;
      const updateValues = [username, name, profilePic, req.user.id];
      const { rows, rowCount } = await connectionPool.query(
        updateQuery,
        updateValues,
      );

      if (!rowCount) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.status(200).json({
        message: "Profile updated successfully",
        user: serializeProfile(req.user, rows[0]),
      });
    } catch (error) {
      return res.status(500).json({ error: "Internal server error" });
    }
    },
  );

  // Reset password route
  authRouter.put("/reset-password", protectUser, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
      await updatePasswordWithCurrentSession({
        email: req.user.email,
        oldPassword,
        newPassword,
      });
      res.status(200).json({ message: "Password updated successfully" });
    } catch (error) {
      const status =
        error.message === "New password is required" ||
        error.message === "Invalid old password"
          ? 400
          : 500;
      res.status(status).json({
        error: status === 400 ? error.message : "Internal server error",
      });
    }
  });

  authRouter.put("/admin/reset-password", protectAdmin, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
      await updatePasswordWithCurrentSession({
        email: req.user.email,
        oldPassword,
        newPassword,
      });
      res.status(200).json({ message: "Password updated successfully" });
    } catch (error) {
      const status =
        error.message === "New password is required" ||
        error.message === "Invalid old password"
          ? 400
          : 500;
      res.status(status).json({
        error: status === 400 ? error.message : "Internal server error",
      });
    }
  });

export default authRouter;