function downloadFile(arg) {
  console.log(chrome.tabs);
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { data: 'download' });
  });

  // chrome.downloads.download({
  //   filename: 'figma.json',
  //   body: `{"layers": ${JSON.stringify(arg)}}`,
  //   saveAs: true
  // });
}