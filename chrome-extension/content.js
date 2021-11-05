window.theRoom.configure({
  blockRedirection: true,
  createInspector: true,
  excludes: [],
  click(element, event) {
    event.preventDefault();
    const json = window.htmlToFigma(getSelector(element));
    chrome.tabs.sendMessage({ data: 'download', payload: json });
    // chrome.windows.getCurrent(function (currentWindow) {
    //   chrome.tabs.query({ active: true, windowId: currentWindow.id }, function (activeTabs) {
    //       activeTabs.map(function (tab) {
    //         chrome.tabs.sendMessage(tab.id, { data: 'download', payload: json });
    //       });
    //   });
    // });
    // window.downloadFile(json);
    // console.log(chrome);
    // chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    //   chrome.tabs.sendMessage(tabs[0].id, { data: 'download', payload: json });
    // });
    window.theRoom.stop(true);
  },
});

// Inspector element styles
const linkElement = document.createElement('link');
linkElement.setAttribute('rel', 'stylesheet');
linkElement.setAttribute('type', 'text/css');
linkElement.setAttribute('href', `data:text/css;charset=UTF-8,${encodeURIComponent('body { cursor: pointer !important; } .inspector-element {  position: absolute; pointer-events: none; border: 2px dashed rgba(28, 151, 204, 1); transition: all 200ms; background-color: rgba(28, 151, 204, 0.5); }')}`);
document.head.appendChild(linkElement);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  alert(message);
  if (message.data === 'init') {
    alert('init');
    window.theRoom.start();
  }
  else if (message.data === 'download') {
    alert('download');
    chrome.downloads.download({
      filename: 'figma.json',
      body: `{"layers": ${JSON.stringify(message.payload)}}`,
      saveAs: true
    });
  }
});