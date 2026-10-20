import { createContext, useContext } from "react";
export type Surface = "user" | "admin";
export const SurfaceContext = createContext<Surface>("user");
export const useSurface = () => useContext(SurfaceContext);
export const userApp =
  import.meta.env.VITE_USER_APP_URL ?? "http://127.0.0.1:5173";
export const adminApp =
  import.meta.env.VITE_ADMIN_APP_URL ?? "http://127.0.0.1:5174";
