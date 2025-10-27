const { StrictMode } = React;
const { createRoot } = ReactDOM;

const FootballManagerLite = window.FootballManagerLite;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FootballManagerLite />
  </StrictMode>
);
