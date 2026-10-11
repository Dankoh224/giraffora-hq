import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Giraffora HQ", short_name: "Giraffora", description: "La empresa virtual de Giraffora",
    start_url: "/", display: "standalone", background_color: "#faf7f2", theme_color: "#d98a1f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
