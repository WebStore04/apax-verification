import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import "dotenv/config";

import activityRoutes from "./routes/activity";
import balanceRoutes from "./routes/balance";
import userRoutes from "./routes/users";
import verificationRoutes from "./routes/verification";

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(cookieParser());
app.use(express.json());

// Routes
app.use("/activity", activityRoutes);
app.use("/balance", balanceRoutes);
app.use("/user", userRoutes);
app.use("/verify", verificationRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ message: "Backend is running!" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
