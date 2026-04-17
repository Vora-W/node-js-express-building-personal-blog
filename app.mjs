import "dotenv/config";

import express from "express";
import cors from "cors";
import blogPostsRouter from "./routes/blogPostsRouter.mjs";
import authRouter from "./routes/authRouter.mjs";
import categoriesRouter from "./routes/categoriesRouter.mjs";

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:5173", // Frontend local (Vite)
      "http://localhost:3000", // Frontend local (React แบบอื่น)
      "https://voranat-w-labs-git-dev-voranats-projects.vercel.app", // Frontend preview ของ branch dev (ที่ Deploy แล้ว)
      "https://voranat-w-labs.vercel.app", // Frontend production domain
    ],
  }),
);

app.get("/health", (req, res) => {
  res.status(200).json({ message: "OK" });
});

app.use("/posts", blogPostsRouter);
app.use("/categories", categoriesRouter);
app.use("/auth", authRouter);

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running at ${port}`);
  });
}

export default app;
