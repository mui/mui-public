"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useSession } from "@/lib/auth-client";

export default function EmbedPage() {
  const { data: session } = useSession();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        p: 4,
      }}
    >
      <Typography variant="h4" gutterBottom>
        Embed View
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        This is a chromeless protected route (no header/nav).
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Signed in as: {session?.user?.email}
      </Typography>
    </Box>
  );
}
