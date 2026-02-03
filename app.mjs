import express from "express";
import cors from "cors";

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/test", (req, res) => {
  res.send("Hello TechUp!");
});

app.get("/profiles", (req, res) => {
  return res.status(200).json({
    data: {
      name: "john",
      age: 20,
    },
  });
});

// Export app for Vercel serverless
export default app;

// Only listen when running locally (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}
