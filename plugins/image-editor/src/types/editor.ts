export type ToolType =
  | 'select'
  | 'crop'
  | 'rect'
  | 'circle'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'highlighter'
  | 'step'
  | 'text'
  | 'mosaic'
  | 'mosaic-brush';

export interface Point {
  x: number;
  y: number;
}

export interface BaseElement {
  id: string;
  type: ToolType;
}

export interface RectElement extends BaseElement {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  strokeWidth: number;
  fill: boolean;
  fillColor?: string;
  radius?: number;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  strokeColor: string;
  strokeWidth: number;
  fill: boolean;
  fillColor?: string;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  strokeColor: string;
  strokeWidth: number;
}

export interface LineElement extends BaseElement {
  type: 'line';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  strokeColor: string;
  strokeWidth: number;
}

export interface PenElement extends BaseElement {
  type: 'pen';
  points: Point[];
  strokeColor: string;
  strokeWidth: number;
}

export interface HighlighterElement extends BaseElement {
  type: 'highlighter';
  points: Point[];
  strokeColor: string;
  strokeWidth: number;
}

export interface StepElement extends BaseElement {
  type: 'step';
  x: number;
  y: number;
  stepNumber: number;
  color: string;
  size: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  bgColor?: string;
}

export interface MosaicElement extends BaseElement {
  type: 'mosaic';
  x: number;
  y: number;
  width: number;
  height: number;
  blockSize: number;
}

export interface MosaicBrushElement extends BaseElement {
  type: 'mosaic-brush';
  points: Point[];
  brushSize: number;
  blockSize: number;
}

export type AnnotationElement =
  | RectElement
  | CircleElement
  | ArrowElement
  | LineElement
  | PenElement
  | HighlighterElement
  | StepElement
  | TextElement
  | MosaicElement
  | MosaicBrushElement;

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AspectRatio = 'free' | '1:1' | '16:9' | '4:3' | '9:16';

export interface EditorSettings {
  strokeColor: string;
  strokeWidth: number;
  fontSize: number;
  fill: boolean;
  mosaicSize: number;
  currentStep: number;
}
