/*
 * WorkSuite Diagram plugin: what it puts in the editors' ribbon, and the window the button opens. Pure, so the
 * tests cover it.
 */
export const TOOLBAR_ITEM = "ws-diagram-insert";
export const INSERT_TAB = "ins"; // the editors' Insert tab

/** The AddToolbarMenuItem argument: one big Diagram button on the Insert tab. */
export function toolbarItems(guid) {
  return {
    guid,
    tabs: [{ id: INSERT_TAB, items: [{
      id: TOOLBAR_ITEM, type: "big-button", text: "Diagram", separator: true, lockInViewMode: true,
      hint: "Draw a flowchart, org chart or other diagram here; double-click it later to change it",
      icons: "resources/%theme-type%(light|dark)/icon%scale%(default).%extension%(png)",
    }] }],
  };
}

/** The window the button opens: the Diagram editor (index.html in window mode), modal, sized as the plugin. */
export const WINDOW = {
  url: "index.html?window", description: "WorkSuite Diagram", isVisual: true, isModal: true, isInsideMode: false,
  EditorsSupport: ["word", "cell", "slide"], size: [1180, 760],
  icons: "resources/%theme-type%(light|dark)/icon%scale%(default).%extension%(png)",
};
