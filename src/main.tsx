import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/literata/400.css";
import "@fontsource/literata/400-italic.css";
import "@fontsource/literata/600.css";
import "@fontsource/literata/700.css";
import "@fontsource/literata/700-italic.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/400-italic.css";
import "@fontsource/source-serif-4/700.css";
import "@fontsource/source-serif-4/700-italic.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/700.css";
import "@fontsource/courier-prime/400-italic.css";
import "@fontsource/courier-prime/700.css";
import "./styles/app.css";
import "./styles/features.css";
import "./styles/features2.css";
import "./styles/features3.css";
import App from "./App";
import PanelApp from "./components/PanelApp";
import { panelParams } from "./lib/panels";

// Las ventanas de panel cargan la misma página con ?panel=…
const panel = panelParams();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{panel ? <PanelApp params={panel} /> : <App />}</React.StrictMode>,
);
