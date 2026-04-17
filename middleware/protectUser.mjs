import { createClient } from "@supabase/supabase-js";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const protectUser = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // **ดึง token จาก Authorization header**
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }
    req.user = { ...data.user };
    next();
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};
export default protectUser;