export default defineBackground(() => {
  // Runs on every service-worker start, so the toolbar icon always opens the side panel.
  void (async () => {
    try {
      await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.error('setPanelBehavior failed', error);
    }
  })();
});
