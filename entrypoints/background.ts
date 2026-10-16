export default defineBackground(() => {
  // Runs on every service-worker start, so the toolbar icon always opens the side panel.
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('setPanelBehavior failed', error));
});
