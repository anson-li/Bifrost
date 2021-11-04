import {
  Button,
  CircularProgress,
  createMuiTheme,
  CssBaseline,
  Divider,
  MuiThemeProvider,
} from "@material-ui/core";
import green from "@material-ui/core/colors/green";
import Favorite from "@material-ui/icons/Favorite";
import * as fileType from "file-type";
import { action, computed, observable, when } from "mobx";
import { observer } from "mobx-react";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as md5 from "spark-md5";
import { arrayBufferToBase64 } from "../lib/functions/buffer-to-base64";
import { SafeComponent } from "./classes/safe-component";
import { theme as themeVars } from "./constants/theme";
import { fastClone } from "./functions/fast-clone";
import { traverseLayers } from "./functions/traverse-layers";
import "./ui.css";

interface ClientStorage {
  imageUrlsByHash: { [hash: string]: string | null } | undefined;
}

const apiKey = process.env.API_KEY || null;
const apiRoot =
  process.env.API_ROOT && process.env.NODE_ENV !== "production"
    ? process.env.API_ROOT
    : "https://builder.io";

const WIDTH_LS_KEY = "builder.widthSetting";
const FRAMES_LS_KEY = "builder.useFramesSetting";

// TODO: make async and use figma.clientStorage
function lsGet(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key)!);
  } catch (err) {
    return undefined;
  }
}
function lsSet(key: string, value: any) {
  try {
    return localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    return undefined;
  }
}

const clamp = (num: number, min: number, max: number) =>
  Math.max(min, Math.min(max, num));

type Node = TextNode | RectangleNode;

const theme = createMuiTheme({
  typography: themeVars.typography,
  palette: {
    primary: { main: themeVars.colors.primary },
    secondary: green,
  },
});

const BASE64_MARKER = ";base64,";
function convertDataURIToBinary(dataURI: string) {
  const base64Index = dataURI.indexOf(BASE64_MARKER) + BASE64_MARKER.length;
  const base64 = dataURI.substring(base64Index);
  const raw = window.atob(base64);
  const rawLength = raw.length;
  const array = new Uint8Array(new ArrayBuffer(rawLength));

  for (let i = 0; i < rawLength; i++) {
    array[i] = raw.charCodeAt(i);
  }
  return array;
}

function getImageFills(layer: Node) {
  const images =
    Array.isArray(layer.fills) &&
    layer.fills.filter((item) => item.type === "IMAGE");
  return images;
}

// TODO: CACHE!
// const imageCache: { [key: string]: Uint8Array | undefined } = {};
async function processImages(layer: Node) {
  const images = getImageFills(layer);

  const convertToSvg = (value: string) => {
    (layer as any).type = "SVG";
    (layer as any).svg = value;
    if (typeof layer.fills !== "symbol") {
      layer.fills = layer.fills.filter((item) => item.type !== "IMAGE");
    }
  };
  return images
    ? Promise.all(
        images.map(async (image: any) => {
          try {
            if (image) {
              const url = image.url;
              if (url.startsWith("data:")) {
                const type = url.split(/[:,;]/)[1];
                if (type.includes("svg")) {
                  const svgValue = decodeURIComponent(url.split(",")[1]);
                  convertToSvg(svgValue);
                  return Promise.resolve();
                } else {
                  if (url.includes(BASE64_MARKER)) {
                    image.intArr = convertDataURIToBinary(url);
                    delete image.url;
                  } else {
                    console.info(
                      "Found data url that could not be converted",
                      url
                    );
                  }
                  return;
                }
              }

              const isSvg = url.endsWith(".svg");

              // Proxy returned content through Builder so we can access cross origin for
              // pulling in photos, etc
              const res = await fetch(
                "https://builder.io/api/v1/proxy-api?url=" +
                  encodeURIComponent(url)
              );

              const contentType = res.headers.get("content-type");
              if (isSvg || (contentType && contentType.includes("svg"))) {
                const text = await res.text();
                convertToSvg(text);
              } else {
                const arrayBuffer = await res.arrayBuffer();
                const type = fileType(arrayBuffer);
                if (
                  type &&
                  (type.ext.includes("svg") || type.mime.includes("svg"))
                ) {
                  convertToSvg(await res.text());
                  return;
                } else {
                  const intArr = new Uint8Array(arrayBuffer);
                  delete image.url;
                  image.intArr = intArr;
                }
              }
            }
          } catch (err) {
            console.warn("Could not fetch image", layer, err);
          }
        })
      )
    : Promise.resolve([]);
}

export type Component = "row" | "stack" | "absolute";

export type SizeType = "shrink" | "expand" | "fixed";

export const sizeTypes: SizeType[] = ["expand", "shrink", "fixed"];

const invalidOptionString = "...";
type InvalidComponentOption = typeof invalidOptionString;

@observer
class App extends SafeComponent {
  editorRef: HTMLIFrameElement | null = null;

  @observable loading = false;
  // TODO: lsget/set?
  @observable lipsum = false; //  process.env.NODE_ENV !== "production";
  @observable loadingGenerate = false;
  @observable apiRoot = apiRoot;
  @observable clientStorage: ClientStorage | null = null;
  @observable errorMessage = "";

  @observable urlValue = "";
  @observable width = lsGet(WIDTH_LS_KEY) || "1200";
  @observable online = navigator.onLine;
  @observable useFrames = lsGet(FRAMES_LS_KEY) || false;
  @observable showMoreOptions = true; // lsGet(MORE_OPTIONS_LS_KEY) || false;
  @observable selection: (BaseNode & { data?: { [key: string]: any } })[] = [];
  @observable.ref selectionWithImages:
    | (BaseNode & {
        data?: { [key: string]: any };
      })[]
    | null = null;

  @observable commandKeyDown = false;
  @observable shiftKeyDown = false;
  @observable altKeyDown = false;
  @observable ctrlKeyDown = false;
  @observable isValidImport: null | boolean = null;
  @observable.ref previewData: any;
  @observable displayFiddleUrl = "";
  @observable currentLanguage = "en";

  editorScriptAdded = false;
  dataToPost: any;

  async getImageUrl(
    intArr: Uint8Array,
    imageHash?: string
  ): Promise<string | null> {
    let hash = imageHash;
    if (!hash) {
      hash = md5.ArrayBuffer.hash(intArr);
    }
    const fromCache =
      hash &&
      this.clientStorage &&
      this.clientStorage.imageUrlsByHash &&
      this.clientStorage.imageUrlsByHash[hash];

    if (fromCache) {
      console.debug("Used URL from cache", fromCache);
      return fromCache;
    }
    if (!apiKey) {
      console.warn("Tried to upload image without API key");
      return null;
    }

    return fetch(`${apiRoot}/api/v1/upload?apiKey=${apiKey}`, {
      method: "POST",
      body: JSON.stringify({
        image: arrayBufferToBase64(intArr),
      }),
      headers: {
        "content-type": "application/json",
      },
    })
      .then((res) => res.json())
      .then((data) => {
        const { url } = data;
        if (typeof url !== "string") {
          return null;
        }
        if (this.clientStorage && hash) {
          if (!this.clientStorage.imageUrlsByHash) {
            this.clientStorage.imageUrlsByHash = {};
          }
          this.clientStorage.imageUrlsByHash[hash] = url;
        }

        return url;
      });
  }

  getDataForSelection(name: string, multipleValuesResponse = null) {
    if (!this.selection.length) {
      return multipleValuesResponse;
    }
    const firstNode = this.selection[0];
    let value = firstNode.data && firstNode.data[name];
    for (const item of this.selection.slice(1)) {
      const itemValue = item.data && item.data[name];
      if (itemValue !== value) {
        return multipleValuesResponse;
      }
    }
    return value;
  }

  async updateStorage() {
    await when(() => !!this.clientStorage);
    parent.postMessage(
      {
        pluginMessage: {
          type: "setStorage",
          data: fastClone(this.clientStorage),
        },
      },
      "*"
    );
  }

  setDataForSelection(name: string, value: any) {
    for (const node of this.selection) {
      if (!node.data) {
        node.data = {
          [name]: value,
        };
      } else {
        node.data[name] = value;
      }
    }
    // TODO: throttleNextTick
    this.saveUpdates();
  }

  form: HTMLFormElement | null = null;
  urlInputRef: HTMLInputElement | null = null;
  iframeRef: HTMLIFrameElement | null = null;

  @computed get urlValid() {
    function validURL(str: string) {
      var pattern = new RegExp(
        "^(https?:\\/\\/)?" + // protocol
          "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // domain name
          "((\\d{1,3}\\.){3}\\d{1,3}))" + // OR ip (v4) address
          "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // port and path
          "(\\?[;&a-z\\d%_.~+=-]*)?" + // query string
          "(\\#[-a-z\\d_]*)?$",
        "i"
      ); // fragment locator
      return !!pattern.test(str);
    }

    return validURL(this.urlValue);
  }

  @action
  updateKeyPositions(event: KeyboardEvent) {
    this.commandKeyDown = event.metaKey;
    this.altKeyDown = event.altKey;
    this.shiftKeyDown = event.shiftKey;
    this.ctrlKeyDown = event.ctrlKey;
  }

  @observable initialized = false;

  componentDidMount() {
    window.addEventListener("message", (e) => {
      const { data: rawData, source } = e as MessageEvent;

      this.initialized = true;

      const data = rawData.pluginMessage;
      if (!data) {
        return;
      }
      if (data.type === "selectionChange") {
        this.selection = data.elements;
      }
      if (data.type === "selectionWithImages") {
        this.selectionWithImages = data.elements;
      }
      if (data.type === "canGetCode") {
        this.isValidImport = data.value;
      }
      if (data.type === "doneLoading") {
        this.loading = false;
      }
      if (data.type === "storage") {
        this.clientStorage = data.data || {};
      }
    });

    parent.postMessage(
      {
        pluginMessage: {
          type: "getStorage",
        },
      },
      "*"
    );
    parent.postMessage(
      {
        pluginMessage: {
          type: "init",
        },
      },
      "*"
    );

    // TODO: destroy on component unmount
    this.safeReaction(
      () => this.urlValue,
      () => (this.errorMessage = "")
    );
    this.selectAllUrlInputText();

    this.safeListenToEvent(window, "offline", () => (this.online = false));
    this.safeListenToEvent(window, "keydown", (e) => {
      this.updateKeyPositions(e as KeyboardEvent);
    });
    this.safeListenToEvent(window, "keyup", (e) => {
      this.updateKeyPositions(e as KeyboardEvent);
    });
    this.safeListenToEvent(window, "online", () => (this.online = true));

    this.safeReaction(
      () => this.clientStorage && fastClone(this.clientStorage),
      () => {
        if (this.clientStorage) {
          this.updateStorage();
        }
      }
    );
  }

  saveUpdates = () => {
    if (this.selection.length) {
      parent.postMessage(
        {
          pluginMessage: {
            type: "updateElements",
            elements: fastClone(this.selection),
          },
        },
        "*"
      );
    }
  };

  selectAllUrlInputText() {
    const input = this.urlInputRef;
    if (input) {
      input.setSelectionRange(0, input.value.length);
    }
  }

  render() {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
          alignItems: "stretch",
          height: "100%",
        }}
      >
        <div
          style={{
            padding: 15,
            fontSize: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              id="title"
              style={{
                display: "flex",
                alignItems: "center",
                fontWeight: "normal",
              }}
            >
              Import your generated component files, and it will be automatically converted into library components.
            </div>
          </div>

          {!this.initialized || this.loading ? (
            <div>
              <div style={{ display: "flex", padding: 20 }}>
                <CircularProgress
                  size={30}
                  disableShrink
                  style={{ margin: "auto" }}
                />
              </div>
            </div>
          ) : (
            <>
              <a
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.setAttribute("webkitdirectory", "");
                  input.setAttribute("multiple", "");
                  document.body.appendChild(input);
                  input.style.visibility = "hidden";
                  input.click();

                  const onFocus = () => {
                    setTimeout(() => {
                      if (
                        input.parentElement &&
                        (!input.files || input.files.length === 0)
                      ) {
                        done();
                      }
                    }, 200);
                  };

                  const done = () => {
                    input.remove();
                    this.loading = false;
                    window.removeEventListener("focus", onFocus);
                  };

                  window.addEventListener("focus", onFocus);

                  // TODO: parse and upload images!
                  input.addEventListener("change", (event) => {
                    const files = (event.target as HTMLInputElement);
                    if (files.files) {
                      this.loading = true;
                      for (let i = 0; i < files.files.length; i++) {
                        var reader = new FileReader();

                      // Closure to capture the file information.
                      reader.onload = (e) => {
                        const text = (e.target as any).result;
                        try {
                          const json = JSON.parse(text);
                          Promise.all(
                            json.layers.map(async (rootLayer: Node) => {
                              await traverseLayers(
                                rootLayer,
                                (layer: any) => {
                                  if (getImageFills(layer)) {
                                    return processImages(layer).catch(
                                      (err) => {
                                        console.warn(
                                          "Could not process image",
                                          err
                                        );
                                      }
                                    );
                                  }
                                }
                              );
                            })
                          )
                            .then(() => {
                              parent.postMessage(
                                {
                                  pluginMessage: {
                                    type: "import",
                                    data: json,
                                  },
                                },
                                "*"
                              );
                            })
                            .catch((err) => {
                              done();
                              console.error(err);
                              alert(err);
                            });
                        } catch (err) {
                          alert("File read error: " + err);
                          done();
                        }
                      };

                        reader.readAsText(files.files[i]);
                      }
                      setTimeout(() => {
                        done();
                      }, 1000);
                    } else {
                      done();
                    }
                  });
                }}
                style={{
                  color: themeVars.colors.primary,
                  cursor: "pointer",
                }}
              >
                <Button
                  fullWidth
                  style={{ marginTop: 20 }}
                  variant="contained"
                  color="primary"
                >
                  Upload
                </Button>
              </a>
            </>
          )}
        </div>
        <div>
          <Divider />
          <div style={{ marginTop: 20, textAlign: "center", color: "#666" }}>
            Made with&nbsp;
            <Favorite
              style={{
                color: "rgb(236, 55, 88)",
                fontSize: 11,
                marginTop: -2,
                verticalAlign: "middle",
              }}
            />
            &nbsp;by the Asgardians of the Galaxy, sponsored by our Experience Design friends.
          </div>
        </div>
      </div>
    );
  }
}

ReactDOM.render(
  <MuiThemeProvider theme={theme}>
    <>
      <CssBaseline />
      <App />
    </>
  </MuiThemeProvider>,
  document.getElementById("react-page")
);
