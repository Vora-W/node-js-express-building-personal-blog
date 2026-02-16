import "dotenv/config";

import express from "express";
import cors from "cors";
import connectionPool from "./utils/db.mjs";
import blogPostsRouter from "./routes/blogPostsRouter.mjs";

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());

app.use(
  cors({
    origin: [
      "http://localhost:5173", // Frontend local (Vite)
      "http://localhost:3000", // Frontend local (React แบบอื่น)
      "https://voranat-w-labs-git-dev-voranats-projects.vercel.app", // Frontend ที่ Deploy แล้ว
    ],
  }),
);

app.get("/health", (req, res) => {
  res.status(200).json({ message: "OK" });
});

app.use("/posts", blogPostsRouter);

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running at ${port}`);
  });
}

export default app;
