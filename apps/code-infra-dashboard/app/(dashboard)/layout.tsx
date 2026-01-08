"use client";

import * as React from "react";
import Link from "next/link";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import MuiLink from "@mui/material/Link";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import ColorSchemeSelector from "../../src/components/ColorSchemeSelector";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 4,
        }}
      >
        <MuiLink
          component={Link}
          href="/"
          sx={{ textDecoration: "none", color: "inherit" }}
        >
          <Typography variant="h6" component="h1">
            Code infra dashboard
          </Typography>
        </MuiLink>
        <ColorSchemeSelector />
      </Box>
      <React.Suspense
        fallback={
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        }
      >
        {children}
      </React.Suspense>
    </Container>
  );
}
