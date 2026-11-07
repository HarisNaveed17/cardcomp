// The toolbar button opens the full comparison page in a tab (a popup is too small for the tables).
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
});
