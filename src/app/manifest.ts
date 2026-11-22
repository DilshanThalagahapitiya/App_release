import type { MetadataRoute } from "next";

/** Makes "Add to Home Screen" open the portal full-screen, like a native app (no browser bars). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Crede App Release Portal",
    short_name: "Crede Releases",
    description: "Install test builds and send feedback.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f0f2f5",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
