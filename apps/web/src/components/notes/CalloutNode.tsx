import {
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
  $createParagraphNode,
} from "lexical";

export type CalloutType = "info" | "warning" | "success";

type SerializedCalloutNode = Spread<{ calloutType: CalloutType }, SerializedElementNode>;

const CALLOUT_STYLES: Record<CalloutType, string> = {
  info: "border-l-[3px] border-blue-400 bg-blue-400/10 rounded-r-md px-3 py-2 my-2",
  warning: "border-l-[3px] border-yellow-400 bg-yellow-400/10 rounded-r-md px-3 py-2 my-2",
  success: "border-l-[3px] border-green-400 bg-green-400/10 rounded-r-md px-3 py-2 my-2",
};

export class CalloutNode extends ElementNode {
  __calloutType: CalloutType;

  static override getType(): string {
    return "callout";
  }

  static override clone(node: CalloutNode): CalloutNode {
    return new CalloutNode(node.__calloutType, node.__key);
  }

  constructor(calloutType: CalloutType = "info", key?: NodeKey) {
    super(key);
    this.__calloutType = calloutType;
  }

  getCalloutType(): CalloutType {
    return this.__calloutType;
  }

  setCalloutType(type: CalloutType): void {
    const self = this.getWritable();
    self.__calloutType = type;
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.className = CALLOUT_STYLES[this.__calloutType];
    return div;
  }

  override updateDOM(prevNode: CalloutNode, dom: HTMLElement): boolean {
    if (prevNode.__calloutType !== this.__calloutType) {
      dom.className = CALLOUT_STYLES[this.__calloutType];
    }
    return false;
  }

  static override importJSON(json: SerializedCalloutNode): CalloutNode {
    return $createCalloutNode(json.calloutType);
  }

  override exportJSON(): SerializedCalloutNode {
    return {
      ...super.exportJSON(),
      type: "callout",
      calloutType: this.__calloutType,
    };
  }

  override insertNewAfter(): null | ElementNode {
    const newBlock = $createParagraphNode();
    this.insertAfter(newBlock);
    return newBlock;
  }

  override collapseAtStart(): boolean {
    const paragraph = $createParagraphNode();
    const children = this.getChildren();
    for (const child of children) {
      paragraph.append(child);
    }
    this.replace(paragraph);
    return true;
  }
}

export function $createCalloutNode(type: CalloutType = "info"): CalloutNode {
  return new CalloutNode(type);
}

export function $isCalloutNode(node: LexicalNode | null | undefined): node is CalloutNode {
  return node instanceof CalloutNode;
}
