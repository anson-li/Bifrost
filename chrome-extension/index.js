document.addEventListener('DOMContentLoaded', () => {
  // get the cta button element
  const selectElementButton = document.getElementById('selectElement');

  // handle cta button click event
  // to be able to start inspection
  selectElementButton.addEventListener('click', () => {
    // send the message to start inspection
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { data: null });
    });

    // close the extension popup
    window.close();
  }, false);
}, false);
