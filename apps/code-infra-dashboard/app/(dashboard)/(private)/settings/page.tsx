"use client";

import * as React from "react";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Avatar from "@mui/material/Avatar";
import { useSession, signOut } from "@/lib/auth-client";

export default function SettingsPage() {
  const { data: session } = useSession();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <Box>
      <Typography variant="h1" gutterBottom>
        Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        This is a protected route. Only authenticated users can access this
        page.
      </Typography>

      <Card sx={{ maxWidth: 400 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
            <Avatar
              src={session?.user?.image ?? undefined}
              alt={session?.user?.name ?? "User"}
            >
              {session?.user?.name?.[0] ?? "U"}
            </Avatar>
            <Box>
              <Typography variant="subtitle1">{session?.user?.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {session?.user?.email}
              </Typography>
            </Box>
          </Box>
          <Button variant="outlined" color="error" onClick={handleSignOut}>
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
