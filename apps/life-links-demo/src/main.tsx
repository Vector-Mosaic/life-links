import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { captureInvitationLink } from "./invitationLink";
import { captureProviderSignInLink } from "./providerSignInLink";
import "./styles.css";

captureInvitationLink(window.location, window.history);
captureProviderSignInLink(window.location, window.history);

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
