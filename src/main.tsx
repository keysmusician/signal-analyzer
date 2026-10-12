import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from "solid-js";
import { render } from "solid-js/web";
import "./styles.css";
import "./theme.css";

type SignalStyle = "solid" | "dashed" | "dotted";

type FrequencyMode = "frequency" | "period";

type PhaseUnit = "degrees" | "turns" | "radians";

type PhasePolarity = "positive" | "signed";

type TrigFunction = "sine" | "cosine" | "tangent" | "cotangent" | "secant" | "cosecant";

interface Wave {
  id: string;
  name: string;
  amplitude: number;
  frequency: number;
  frequencyMode: FrequencyMode;
  phase: number;
  phaseUnit: PhaseUnit;
  phasePolarity: PhasePolarity;
  trigFunction: TrigFunction;
  color: string;
  opacity: number;
  visible: boolean;
  style: SignalStyle;
  thickness: number;
}

const phaseToRadians = (phase: number, unit: PhaseUnit) =>
  unit === "degrees" ? phase * Math.PI / 180 : unit === "turns" ? phase * 2 * Math.PI : phase;

const radiansToPhase = (radians: number, unit: PhaseUnit) =>
  unit === "degrees" ? radians * 180 / Math.PI : unit === "turns" ? radians / (2 * Math.PI) : radians;

const normalizePhase = (phase: number, unit: PhaseUnit, polarity: PhasePolarity) => {
  const radians = phaseToRadians(phase, unit);
  const cycle = 2 * Math.PI;
  if (polarity === "positive") {
    const normalized = ((radians % cycle) + cycle) % cycle;
    return radiansToPhase(normalized === 0 && radians > 0 ? cycle : normalized, unit);
  }

  let normalized = ((radians + Math.PI) % cycle + cycle) % cycle - Math.PI;
  if (normalized === -Math.PI && radians > 0) normalized = Math.PI;
  return radiansToPhase(normalized, unit);
};

interface SignalGroup {
  id: string;
  name: string;
  waveIds: string[];
  color: string;
  opacity: number;
  visible: boolean;
  style: SignalStyle;
  thickness: number;
}

interface ScopeSettings {
  amplitudePerDivision: number;
  secondsPerDivision: number;
}

type WindowFunction = "rectangular" | "hann" | "hamming";

interface FourierSettings {
  sampleCount: number;
  duration: number;
  window: WindowFunction;
}

const ANALYZER_TYPES = ["oscilloscope", "meter", "frequency"] as const;
type AnalyzerType = typeof ANALYZER_TYPES[number];

const ANALYZER_LABELS: Record<AnalyzerType, string> = {
  oscilloscope: "Oscilloscope",
  meter: "Level meter",
  frequency: "Frequency domain",
};

const ANALYZER_DESCRIPTIONS: Record<AnalyzerType, string> = {
  oscilloscope: "View signals over time and inspect their real, imaginary, or phase components.",
  meter: "Compare a signal level with full scale or another signal.",
  frequency: "Inspect signal magnitude and phase across frequency.",
};

interface SavedState {
  waves: Wave[];
  groups: SignalGroup[];
  settings: ScopeSettings;
  fourierSettings: FourierSettings;
  analyzers: AnalyzerType[];
}

const STORAGE_KEY = "signal-analyzer-state";
const LEGACY_STORAGE_KEY = "oscilloscope-state";

const COLORS = ["#52e0c4", "#8b83ff", "#ffb454", "#ff718d", "#55aaff", "#c7e46a"];

const formatAxisValue = (value: number) => Number(value.toPrecision(3)).toString();

function waveValueAt(wave: Wave, time: number, phaseOffset = 0) {
  const radians = (2 * Math.PI * wave.frequency * time) + phaseOffset
    + (wave.phaseUnit === "degrees"
      ? wave.phase * Math.PI / 180
      : wave.phaseUnit === "turns"
        ? wave.phase * 2 * Math.PI
        : wave.phase);
  const trigValue = wave.trigFunction === "sine"
    ? Math.sin(radians)
    : wave.trigFunction === "cosine"
      ? Math.cos(radians)
      : wave.trigFunction === "tangent"
        ? Math.tan(radians)
        : wave.trigFunction === "cotangent"
          ? 1 / Math.tan(radians)
          : wave.trigFunction === "secant"
            ? 1 / Math.cos(radians)
            : 1 / Math.sin(radians);
  return wave.amplitude * Math.max(-10, Math.min(10, trigValue));
}

function hexToHsv(hex: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return { hue: 0, saturation: 0, value: 1 };

  const red = parseInt(match[1].slice(0, 2), 16) / 255;

  const green = parseInt(match[1].slice(2, 4), 16) / 255;

  const blue = parseInt(match[1].slice(4, 6), 16) / 255;

  const max = Math.max(red, green, blue);

  const min = Math.min(red, green, blue);

  const difference = max - min;

  const hue = difference === 0
    ? 0
    : max === red
      ? 60 * (((green - blue) / difference) % 6)
      : max === green
        ? 60 * ((blue - red) / difference + 2)
        : 60 * ((red - green) / difference + 4);

  return {
    hue: (hue + 360) % 360,
    saturation: max === 0 ? 0 : difference / max,
    value: max,
  };
}

function hsvToHex(hue: number, saturation: number, value: number) {
  const chroma = value * saturation;

  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));

  const offset = value - chroma;

  const [red, green, blue] =
    hue < 60 ? [chroma, secondary, 0]
      : hue < 120 ? [secondary, chroma, 0]
        : hue < 180 ? [0, chroma, secondary]
          : hue < 240 ? [0, secondary, chroma]
            : hue < 300 ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function createWave(number: number): Wave {
  return {
    id: crypto.randomUUID(),
    name: `Signal ${number}`,
    amplitude: 2,
    frequency: number === 1 ? 1 : 2,
    frequencyMode: "frequency",
    phase: 0,
    phaseUnit: "degrees",
    phasePolarity: "signed",
    trigFunction: "sine",
    color: COLORS[(number - 1) % COLORS.length],
    opacity: 1,
    visible: true,
    style: "solid",
    thickness: 2,
  };
}

function createGroup(number: number, waveIds: string[] = []): SignalGroup {
  return {
    id: crypto.randomUUID(),
    name: `Group ${number}`,
    waveIds,
    color: COLORS[(number - 1) % COLORS.length],
    opacity: 1,
    visible: true,
    style: "solid",
    thickness: 2,
  };
}

function loadSavedState(): SavedState {
  const fallbackWave = createWave(1);
  const fallback = {
    waves: [fallbackWave],
    groups: [createGroup(1, [fallbackWave.id])],
    settings: { amplitudePerDivision: 1, secondsPerDivision: 0.25 },
    fourierSettings: { sampleCount: 256, duration: 2.5, window: "hann" as WindowFunction },
    analyzers: [...ANALYZER_TYPES],
  };
  const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!stored) return fallback;

  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "waves" in parsed &&
      Array.isArray(parsed.waves) &&
      "settings" in parsed &&
      typeof parsed.settings === "object" &&
      parsed.settings !== null &&
      "secondsPerDivision" in parsed.settings &&
      typeof parsed.settings.secondsPerDivision === "number"
    ) {
      const savedSettings = parsed.settings;

      const secondsPerDivision =
        "secondsPerDivision" in savedSettings && typeof savedSettings.secondsPerDivision === "number"
          ? savedSettings.secondsPerDivision
          : undefined;

      const amplitudePerDivision =
        "amplitudePerDivision" in savedSettings && typeof savedSettings.amplitudePerDivision === "number"
          ? savedSettings.amplitudePerDivision
          : "voltsPerDivision" in savedSettings && typeof savedSettings.voltsPerDivision === "number"
            ? savedSettings.voltsPerDivision
            : undefined;
      if (amplitudePerDivision === undefined || secondsPerDivision === undefined) {
        console.warn("Saved signal analyzer settings are invalid; using defaults.");
        return fallback;
      }
      const waves: Wave[] = (parsed.waves as Wave[]).map((wave) => {
        const phaseUnit: PhaseUnit =
          wave.phaseUnit === "turns" || wave.phaseUnit === "radians" ? wave.phaseUnit : "degrees";
        const phasePolarity: PhasePolarity =
          wave.phasePolarity === "positive" ? "positive" : "signed";
        return {
          ...wave,
          frequencyMode: wave.frequencyMode === "period" ? "period" : "frequency",
          phase: normalizePhase(Number.isFinite(wave.phase) ? wave.phase : 0, phaseUnit, phasePolarity),
          phaseUnit,
          phasePolarity,
          trigFunction: wave.trigFunction === "cosine" || wave.trigFunction === "tangent"
            || wave.trigFunction === "cotangent" || wave.trigFunction === "secant"
            || wave.trigFunction === "cosecant" ? wave.trigFunction : "sine",
          opacity: Number.isFinite(wave.opacity) ? Math.max(0, Math.min(1, wave.opacity)) : 1,
          visible: typeof wave.visible === "boolean" ? wave.visible : true,
        };
      }) as Wave[];
      const savedGroups = "groups" in parsed && Array.isArray(parsed.groups)
        ? parsed.groups as SignalGroup[]
        : [];
      const groups: SignalGroup[] = (savedGroups.length > 0
        ? savedGroups.map((group) => ({
          ...group,
          waveIds: group.waveIds.filter((id) => waves.some((wave) => wave.id === id)),
          opacity: Number.isFinite(group.opacity) ? Math.max(0, Math.min(1, group.opacity)) : 1,
          visible: typeof group.visible === "boolean" ? group.visible : true,
          style: group.style === "dashed" || group.style === "dotted" ? group.style : "solid",
          thickness: Number.isFinite(group.thickness) ? group.thickness : 2,
        }))
        : [createGroup(1, waves.map((wave) => wave.id))]) as SignalGroup[];
      const assignedWaveIds = new Set(groups.flatMap((group) => group.waveIds));
      const orphanedWaveIds = waves.map((wave) => wave.id).filter((id) => !assignedWaveIds.has(id));
      if (orphanedWaveIds.length > 0) {
        groups[0].waveIds.push(...orphanedWaveIds);
      }
      const savedFourierSettings = "fourierSettings" in parsed && typeof parsed.fourierSettings === "object"
        && parsed.fourierSettings !== null
        ? parsed.fourierSettings as Record<string, unknown>
        : undefined;
      const analyzers = "analyzers" in parsed && Array.isArray(parsed.analyzers)
        ? Array.from(new Set(parsed.analyzers.filter((analyzer): analyzer is AnalyzerType =>
          ANALYZER_TYPES.includes(analyzer as AnalyzerType),
        )))
        : fallback.analyzers;
      return {
        waves,
        groups,
        analyzers,
        fourierSettings: savedFourierSettings
          ? {
            sampleCount: [128, 256, 512, 1024].includes(savedFourierSettings.sampleCount as number)
              ? savedFourierSettings.sampleCount as number : 256,
            duration: typeof savedFourierSettings.duration === "number"
              && savedFourierSettings.duration > 0 ? savedFourierSettings.duration : 2.5,
            window: savedFourierSettings.window === "rectangular" || savedFourierSettings.window === "hamming"
              ? savedFourierSettings.window : "hann",
          }
          : fallback.fourierSettings,
        settings: {
          amplitudePerDivision,
          secondsPerDivision,
        },
      };
    }
    console.warn("Saved signal analyzer settings are invalid; using defaults.");
  } catch (error) {
    console.error("Unable to read saved signal analyzer settings.", error);
  }
  return fallback;
}

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

const ColorPicker: Component<ColorPickerProps> = (props) => {
  let picker: HTMLDivElement | undefined;
  let colorPlane: HTMLDivElement | undefined;
  let draggingPlane = false;
  const [open, setOpen] = createSignal(false);
  const [hue, setHue] = createSignal(hexToHsv(props.color).hue);
  const currentColor = () => hexToHsv(props.color);

  const setFromPlane = (event: PointerEvent) => {
    if (!colorPlane) return;
    const bounds = colorPlane.getBoundingClientRect();
    const saturation = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const value = 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    props.onChange(hsvToHex(hue(), saturation, value));
  };

  const chooseHue = (nextHue: number) => {
    setHue(nextHue);
    const color = currentColor();
    props.onChange(hsvToHex(nextHue, color.saturation, color.value));
  };

  onMount(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (open() && picker && event.target instanceof Node && !picker.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    onCleanup(() => document.removeEventListener("pointerdown", closeOnOutsidePointer));
  });

  return (
    <div class="color-picker" ref={picker}>
      <button
        class="color-swatch"
        type="button"
        aria-label="Choose signal color"
        aria-expanded={open()}
        style={{ "--swatch-color": props.color }}
        onClick={() => {
          setHue(hexToHsv(props.color).hue);
          setOpen(true);
        }}
      />
      <Show when={open()}>
        <div
          class="color-picker-popover"
          role="group"
          aria-label="Signal color picker"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div
            class="saturation-plane"
            aria-label="Color saturation and brightness"
            ref={colorPlane}
            style={{ "--picker-hue": `${hue()}deg` }}
            onPointerDown={(event) => {
              draggingPlane = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              setFromPlane(event);
            }}
            onPointerMove={(event) => {
              if (draggingPlane) setFromPlane(event);
            }}
            onPointerUp={() => { draggingPlane = false; }}
            onPointerCancel={() => { draggingPlane = false; }}
          >
            <span
              class="saturation-marker"
              style={{
                left: `${currentColor().saturation * 100}%`,
                top: `${(1 - currentColor().value) * 100}%`,
              }}
            />
          </div>
          <input
            class="hue-slider"
            type="range"
            min="0"
            max="359"
            aria-label="Color hue"
            value={hue()}
            onInput={(event) => chooseHue(Number(event.currentTarget.value))}
          />
          <output class="color-value">{props.color.toUpperCase()}</output>
        </div>
      </Show>
    </div>
  );
};

interface WaveEditorProps {
  wave: Wave;
  index: number;
  onChange: (id: string, changes: Partial<Wave>) => void;
  onRemove: (id: string) => void;
  phaseEditorOpen: boolean;
  onPhaseEditorOpenChange: (waveId: string | undefined) => void;
}

interface PhaseControlProps {
  wave: Wave;
  onChange: (id: string, changes: Partial<Wave>) => void;
  editorOpen: boolean;
  onEditorOpenChange: (waveId: string | undefined) => void;
}

const PhaseControl: Component<PhaseControlProps> = (props) => {
  let phaseEditorContainer: HTMLDivElement | undefined;
  let activePointerId: number | undefined;
  const [draftPhase, setDraftPhase] = createSignal(props.wave.phase);

  createEffect(() => setDraftPhase(props.wave.phase));

  onMount(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        props.editorOpen
        && phaseEditorContainer
        && event.target instanceof Node
        && !phaseEditorContainer.contains(event.target)
      ) {
        props.onEditorOpenChange(undefined);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    onCleanup(() => document.removeEventListener("pointerdown", closeOnOutsidePointer));
  });

  const limits = () => {
    const signed = props.wave.phasePolarity === "signed";
    return props.wave.phaseUnit === "degrees"
      ? { min: signed ? -180 : 0, max: signed ? 180 : 360, step: 1 }
      : props.wave.phaseUnit === "turns"
        ? { min: signed ? -0.5 : 0, max: signed ? 0.5 : 1, step: 0.01 }
        : { min: signed ? -Math.PI : 0, max: signed ? Math.PI : 2 * Math.PI, step: 0.01 };
  };

  const unitDisplay = () => props.wave.phaseUnit === "degrees"
    ? "°"
    : props.wave.phaseUnit === "turns"
      ? "τ"
      : "rad";

  const setPolarity = (polarity: PhasePolarity) => {
    props.onChange(props.wave.id, {
      phase: normalizePhase(props.wave.phase, props.wave.phaseUnit, polarity),
      phasePolarity: polarity,
    });
  };

  const setPhaseFromPointer = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * 200;
    const y = (event.clientY - bounds.top) / bounds.height * 200;
    const radians = Math.atan2(100 - y, x - 100);
    const phase = normalizePhase(radiansToPhase(radians, props.wave.phaseUnit), props.wave.phaseUnit, props.wave.phasePolarity);
    setDraftPhase(phase);
    props.onChange(props.wave.id, { phase });
  };

  const adjustPhaseByKey = (event: KeyboardEvent) => {
    const { min, max, step } = limits();
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -1
        : 0;
    if (!direction) return;
    event.preventDefault();
    props.onChange(props.wave.id, {
      phase: Math.max(min, Math.min(max, props.wave.phase + direction * step)),
    });
  };

  return (
    <div class="field-control">
      <div class="field-title">
        <span>Phase</span>
        <div class="phase-editor-container" ref={phaseEditorContainer}>
          <button
            class="frequency-toggle phase-editor-button"
            type="button"
            aria-label={`Open phase editor for ${props.wave.name}`}
            aria-haspopup="dialog"
            aria-expanded={props.editorOpen}
            title="Open phase editor"
            onClick={() => props.onEditorOpenChange(props.editorOpen ? undefined : props.wave.id)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="8" />
              <circle cx="10" cy="10" r="4" />
              <path d="M1 10h18M10 1v18" />
              <circle cx="10" cy="10" r="1" class="phase-editor-icon-center" />
            </svg>
          </button>
          <Show when={props.editorOpen}>
            <div
              class="phase-editor-popover"
              role="dialog"
              aria-label={`${props.wave.name} phase editor`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div class="phase-editor-heading">
                <strong>Phase</strong>
                <button
                  class="frequency-toggle phase-polarity-toggle"
                  type="button"
                  aria-label={`Switch to ${props.wave.phasePolarity === "positive" ? "signed" : "positive"} phase range`}
                  aria-pressed={props.wave.phasePolarity === "positive"}
                  title={`Switch to ${props.wave.phasePolarity === "positive" ? "signed" : "positive"} phase range`}
                  onClick={() => setPolarity(props.wave.phasePolarity === "positive" ? "signed" : "positive")}
                >
                  {props.wave.phasePolarity === "positive" ? "+" : "±"}
                </button>
              </div>
              <svg
                class="phase-editor-dial"
                viewBox="0 0 200 200"
                style={{ "--phase-point-color": props.wave.color }}
                role="slider"
                aria-label="Signal phase"
                aria-valuemin={limits().min}
                aria-valuemax={limits().max}
                aria-valuenow={draftPhase()}
                aria-valuetext={`${draftPhase().toFixed(6)} ${unitDisplay()}`}
                tabIndex={0}
                onKeyDown={adjustPhaseByKey}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  activePointerId = event.pointerId;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setPhaseFromPointer(event);
                }}
                onPointerMove={(event) => {
                  if (activePointerId === event.pointerId) setPhaseFromPointer(event);
                }}
                onPointerUp={(event) => {
                  if (activePointerId === event.pointerId) activePointerId = undefined;
                }}
                onPointerCancel={() => { activePointerId = undefined; }}
                onLostPointerCapture={() => { activePointerId = undefined; }}
              >
                <circle class="phase-editor-ring" cx="100" cy="100" r="72" />
                <circle class="phase-editor-ring phase-editor-inner-ring" cx="100" cy="100" r="36" />
                <path class="phase-editor-crosshair" d="M20 100h160M100 20v160" />
                <line
                  class="phase-editor-radius"
                  x1="100"
                  y1="100"
                  x2={100 + Math.cos(phaseToRadians(draftPhase(), props.wave.phaseUnit)) * 72}
                  y2={100 - Math.sin(phaseToRadians(draftPhase(), props.wave.phaseUnit)) * 72}
                />
                <circle
                  class="phase-editor-point"
                  cx={100 + Math.cos(phaseToRadians(draftPhase(), props.wave.phaseUnit)) * 72}
                  cy={100 - Math.sin(phaseToRadians(draftPhase(), props.wave.phaseUnit)) * 72}
                  r="6"
                />
              </svg>
              <output class="phase-editor-value" aria-live="polite">
                {draftPhase().toFixed(6)} {unitDisplay()}
              </output>
            </div>
          </Show>
        </div>
      </div>
      <div class="input-with-unit phase-input">
        <NumericInput
          min={limits().min}
          max={limits().max}
          ariaLabel={`Phase ${props.wave.phaseUnit}`}
          value={props.wave.phase}
          onValue={(value) => props.onChange(props.wave.id, { phase: value })}
        />
        <span class="phase-unit-display" aria-hidden="true">{unitDisplay()}</span>
        <select
          class="phase-unit-select"
          aria-label="Phase unit"
          value={props.wave.phaseUnit}
          onChange={(event) => {
            const unit = event.currentTarget.value as PhaseUnit;
            props.onChange(props.wave.id, {
              phase: normalizePhase(radiansToPhase(phaseToRadians(props.wave.phase, props.wave.phaseUnit), unit), unit, props.wave.phasePolarity),
            });
            props.onChange(props.wave.id, { phaseUnit: unit });
          }}
        >
          <option value="degrees">Degrees</option>
          <option value="turns">Turns</option>
          <option value="radians">Radians</option>
        </select>
      </div>
    </div>
  );
};

const WaveEditor: Component<WaveEditorProps> = (props) => {
  let functionMenu: HTMLDivElement | undefined;
  const [styleOpen, setStyleOpen] = createSignal(false);
  const [functionOpen, setFunctionOpen] = createSignal(false);

  onMount(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!functionMenu?.contains(event.target as Node)) setFunctionOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    onCleanup(() => document.removeEventListener("pointerdown", closeOnOutsidePointer));
  });

  const isPeriod = () => props.wave.frequencyMode === "period";

  const displayFrequency = () => isPeriod()
    ? props.wave.frequency === 0 ? 0 : Number((1 / props.wave.frequency).toPrecision(6))
    : props.wave.frequency;

  const update = (key: keyof Wave, value: string | number | boolean) =>
    props.onChange(props.wave.id, { [key]: value });

  return (
    <article class="wave-card">
      <header class="wave-header">
        <button
          class="channel-mark"
          type="button"
          aria-label={`${props.wave.visible ? "Hide" : "Show"} ${props.wave.name}`}
          aria-pressed={props.wave.visible}
          title={`${props.wave.visible ? "Hide" : "Show"} ${props.wave.name}`}
          style={{ "--channel-color": props.wave.color, opacity: props.wave.visible ? props.wave.opacity : 0.3 }}
          onClick={() => update("visible", !props.wave.visible)}
        />
        <input
          class="wave-name"
          aria-label={`Signal ${props.index + 1} name`}
          value={props.wave.name}
          onInput={(event) => update("name", event.currentTarget.value)}
        />
        <div ref={functionMenu} class="function-menu">
          <button
            class="icon-button function-button"
            type="button"
            aria-label="Signal function"
            aria-expanded={functionOpen()}
            onClick={() => setFunctionOpen(!functionOpen())}
          >
            <span class="function-icon">f</span>
          </button>
          <Show when={functionOpen()}>
            <div class="function-popover" role="menu">
              <For each={[
                ["sine", "Sine"],
                ["cosine", "Cosine"],
                ["tangent", "Tangent"],
                ["cotangent", "Cotangent"],
                ["secant", "Secant"],
                ["cosecant", "Cosecant"],
              ] as [TrigFunction, string][]}>
                {(item) => (
                  <button
                    type="button"
                    role="menuitem"
                    class={props.wave.trigFunction === item[0] ? "selected" : undefined}
                    onClick={() => {
                      update("trigFunction", item[0]);
                      setFunctionOpen(false);
                    }}
                  >
                    {item[1]}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <button
          class="icon-button style-button"
          type="button"
          aria-label="Signal style"
          aria-expanded={styleOpen()}
          onClick={() => setStyleOpen(!styleOpen())}
        >
          <span class={`line-preview ${props.wave.style}`} style={{ color: props.wave.color, opacity: props.wave.opacity }} />
        </button>
        <button
          class="icon-button remove-button"
          type="button"
          aria-label={`Remove ${props.wave.name}`}
          onClick={() => props.onRemove(props.wave.id)}
        >
          ×
        </button>
      </header>
      <Show when={styleOpen()}>
        <div class="style-panel" onClick={() => setStyleOpen(true)}>
          <div class="color-control">
            <span>Color</span>
            <ColorPicker
              color={props.wave.color}
              onChange={(color) => update("color", color)}
            />
          </div>
          <label class="field-control">
            <span>Line</span>
            <select
              value={props.wave.style}
              onChange={(event) => update("style", event.currentTarget.value)}
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </label>
          <label class="field-control">
            <span>Weight</span>
            <input
              type="number"
              min="1"
              max="6"
              step="0.5"
              value={props.wave.thickness}
              onInput={(event) => update("thickness", Number(event.currentTarget.value))}
            />
          </label>
          <label class="opacity-control">
            <span>Opacity</span>
            <div class="opacity-input">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                aria-label="Signal opacity"
                value={props.wave.opacity}
                style={{ "--signal-color": props.wave.color }}
                onInput={(event) => update("opacity", Number(event.currentTarget.value))}
              />
              <output>{Math.round(props.wave.opacity * 100)}%</output>
            </div>
          </label>
        </div>
      </Show>
      <div class="wave-fields">
        <label class="field-control">
          <span>Amplitude</span>
          <NumericInput
            class="plain-number"
            min={-20}
            max={20}
            ariaLabel="Amplitude"
            value={props.wave.amplitude}
            onValue={(value) => update("amplitude", value)}
          />
        </label>
        <label class="field-control">
          <div class="field-title">
            <span>{isPeriod() ? "Period" : "Frequency"}</span>
            <button
              class="frequency-toggle"
              type="button"
              aria-label={`Switch to ${isPeriod() ? "frequency" : "period"}`}
              title={`Switch to ${isPeriod() ? "frequency" : "period"}`}
              onClick={() => update("frequencyMode", isPeriod() ? "frequency" : "period")}
            >
              ↔
            </button>
          </div>
          <div class="input-with-unit">
            <Show
              when={!isPeriod() || props.wave.frequency !== 0}
              fallback={<span class="infinite-value" aria-label="Infinite period">∞</span>}
            >
              <NumericInput
                ariaLabel={isPeriod() ? "Period" : "Frequency"}
                min={-100}
                max={100}
                value={displayFrequency()}
                onValue={(value) => {
                  if (isPeriod() && value === 0) return;
                  update("frequency", isPeriod() ? 1 / value : value);
                }}
              />
            </Show>
            <small>{isPeriod() ? "s" : "Hz"}</small>
          </div>
        </label>
        <PhaseControl
          wave={props.wave}
          onChange={props.onChange}
          editorOpen={props.phaseEditorOpen}
          onEditorOpenChange={props.onPhaseEditorOpenChange}
        />
      </div>
    </article>
  );
};

interface OscilloscopeProps {
  waves: Wave[];
  groups: SignalGroup[];
  settings: ScopeSettings;
  onScaleChange: (axis: keyof ScopeSettings, value: number) => void;
  onRemove: () => void;
}

interface NumericInputProps {
  value: number;
  min?: number;
  max?: number;
  class?: string;
  ariaLabel: string;
  onValue: (value: number) => void;
}

const NumericInput: Component<NumericInputProps> = (props) => {
  const [draft, setDraft] = createSignal(String(props.value));
  const [focused, setFocused] = createSignal(false);
  const [invalid, setInvalid] = createSignal(false);

  createEffect(() => {
    if (!focused()) setDraft(String(props.value));
  });

  const parseValue = (value: string) => {
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number) || (props.min !== undefined && number < props.min)
      || (props.max !== undefined && number > props.max)) return undefined;
    return number;
  };

  return (
    <input
      class={props.class}
      type="text"
      inputmode="decimal"
      aria-label={props.ariaLabel}
      value={draft()}
      onFocus={() => setFocused(true)}
      onInput={(event) => {
        const value = event.currentTarget.value;
        setDraft(value);
        const number = parseValue(value);
        setInvalid(number === undefined);
        if (number !== undefined) props.onValue(number);
      }}
      onBlur={() => setFocused(false)}
      classList={{ "numeric-invalid": invalid() }}
    />
  );
};

type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "signal-analyzer-theme";

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: "light", label: "Light", icon: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" },
  { mode: "dark", label: "Dark", icon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" },
  { mode: "system", label: "System", icon: "M3 5h18v11H3zM8 20h8M12 16v4" },
];

const loadThemeMode = (): ThemeMode => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);

    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
};

const ThemeToggle: Component = () => {
  const [mode, setMode] = createSignal<ThemeMode>(loadThemeMode());

  createEffect(() => {
    const current = mode();

    const query = window.matchMedia("(prefers-color-scheme: light)");

    const apply = () => {
      document.documentElement.dataset.theme = current === "system" ? (query.matches ? "light" : "dark") : current;
    };

    apply();

    try {
      localStorage.setItem(THEME_STORAGE_KEY, current);
    } catch (error) {
      console.error("Unable to save theme preference.", error);
    }

    if (current === "system") {
      query.addEventListener("change", apply);
      onCleanup(() => query.removeEventListener("change", apply));
    }
  });

  return (
    <div class="theme-toggle" role="radiogroup" aria-label="Color theme">
      <For each={THEME_OPTIONS}>
        {(option) => (
          <button
            type="button"
            role="radio"
            class={mode() === option.mode ? "active" : ""}
            aria-checked={mode() === option.mode}
            aria-label={option.label}
            title={option.label}
            onClick={() => setMode(option.mode)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={option.icon} /></svg>
          </button>
        )}
      </For>
    </div>
  );
};

const AppHeader: Component = () => (
  <header class="app-header">
    <a class="brand" href="/" aria-label="Signal Analyzer home">
      <span class="brand-icon"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M2 14h5l3-8 6 16 4-8h6" /></svg></span>
      <span>Signal Analyzer</span>
    </a>
    <ThemeToggle />
  </header>
);

interface SignalsSectionProps {
  waves: Wave[];
  groups: SignalGroup[];
  phaseEditorWaveId?: string;
  onPhaseEditorWaveIdChange: (waveId: string | undefined) => void;
  onChange: (id: string, changes: Partial<Wave>) => void;
  onRemove: (id: string) => void;
  onGroupChange: (id: string, changes: Partial<SignalGroup>) => void;
  onRemoveGroup: (id: string) => void;
  onAddWave: (groupId: string) => void;
  onAddGroup: () => void;
}

interface GroupEditorProps {
  group: SignalGroup;
  waves: Wave[];
  phaseEditorWaveId?: string;
  onPhaseEditorWaveIdChange: (waveId: string | undefined) => void;
  onChange: (id: string, changes: Partial<Wave>) => void;
  onRemove: (id: string) => void;
  onGroupChange: (id: string, changes: Partial<SignalGroup>) => void;
  onRemoveGroup: (id: string) => void;
  onAddWave: (groupId: string) => void;
  index: number;
}

const GroupEditor: Component<GroupEditorProps> = (props) => {
  const [styleOpen, setStyleOpen] = createSignal(false);
  const update = (key: keyof SignalGroup, value: string | number | boolean) =>
    props.onGroupChange(props.group.id, { [key]: value });

  return (
    <section class="group-card">
      <header class="group-header">
        <button
          class="channel-mark"
          type="button"
          aria-label={`${props.group.visible ? "Hide" : "Show"} ${props.group.name}`}
          aria-pressed={props.group.visible}
          title={`${props.group.visible ? "Hide" : "Show"} ${props.group.name}`}
          style={{ "--channel-color": props.group.color, opacity: props.group.visible ? props.group.opacity : 0.3 }}
          onClick={() => update("visible", !props.group.visible)}
        />
        <input
          class="wave-name"
          aria-label={`Group ${props.index + 1} name`}
          value={props.group.name}
          onInput={(event) => update("name", event.currentTarget.value)}
        />
        <span class="group-signal-count" title="Signals in group" aria-label={`${props.group.waveIds.length} signals`}>
          Signals: {props.group.waveIds.length}
        </span>
        <button
          class="icon-button style-button"
          type="button"
          aria-label="Group style"
          aria-expanded={styleOpen()}
          onClick={() => setStyleOpen(!styleOpen())}
        >
          <span class={`line-preview ${props.group.style}`} style={{ color: props.group.color, opacity: props.group.opacity }} />
        </button>
        <button
          class="icon-button remove-button"
          type="button"
          aria-label={`Remove ${props.group.name} and its signals`}
          onClick={() => props.onRemoveGroup(props.group.id)}
        >
          ×
        </button>
      </header>
      <Show when={styleOpen()}>
        <div class="style-panel group-style-panel">
          <div class="color-control">
            <span>Color</span>
            <ColorPicker color={props.group.color} onChange={(color) => update("color", color)} />
          </div>
          <label class="field-control">
            <span>Line</span>
            <select value={props.group.style} onChange={(event) => update("style", event.currentTarget.value)}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </label>
          <label class="field-control">
            <span>Weight</span>
            <NumericInput min={1} max={6} value={props.group.thickness} ariaLabel="Group weight" onValue={(value) => update("thickness", value)} />
          </label>
          <label class="opacity-control">
            <span>Opacity</span>
            <div class="opacity-input">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                aria-label="Group opacity"
                value={props.group.opacity}
                style={{ "--signal-color": props.group.color }}
                onInput={(event) => update("opacity", Number(event.currentTarget.value))}
              />
              <output>{Math.round(props.group.opacity * 100)}%</output>
            </div>
          </label>
        </div>
      </Show>
      <div class="group-signals">
        <For each={props.group.waveIds}>
          {(waveId, index) => {
            const wave = () => props.waves.find((item) => item.id === waveId);
            return (
              <Show when={wave()}>
                {(item) => (
                  <WaveEditor
                    wave={item()}
                    index={index()}
                    onChange={props.onChange}
                    onRemove={props.onRemove}
                    phaseEditorOpen={props.phaseEditorWaveId === item().id}
                    onPhaseEditorOpenChange={props.onPhaseEditorWaveIdChange}
                  />
                )}
              </Show>
            );
          }}
        </For>
        <button class="add-wave group-add-wave" type="button" onClick={() => props.onAddWave(props.group.id)}>
          <span>+</span><span class="add-wave-label">Add new signal</span>
        </button>
      </div>
    </section>
  );
};

const SignalsSection: Component<SignalsSectionProps> = (props) => (
  <>
    <div class="section-heading">
      <h1>Signals</h1>
      <div class="section-counts">
        <span class="channel-count" title="Groups" aria-label={`${props.groups.length} groups`}>Groups: {props.groups.length}</span>
        <span class="channel-count" title="Signals" aria-label={`${props.waves.length} signals`}>Signals: {props.waves.length}</span>
      </div>
    </div>
    <div class="channel-list">
      <For each={props.groups}>
        {(group, index) => (
          <GroupEditor
            group={group}
            waves={props.waves}
            phaseEditorWaveId={props.phaseEditorWaveId}
            onPhaseEditorWaveIdChange={props.onPhaseEditorWaveIdChange}
            index={index()}
            onChange={props.onChange}
            onRemove={props.onRemove}
            onGroupChange={props.onGroupChange}
            onRemoveGroup={props.onRemoveGroup}
            onAddWave={props.onAddWave}
          />
        )}
      </For>
    </div>
    <button class="add-wave add-group" type="button" onClick={props.onAddGroup}>
      <span>+</span><span class="add-wave-label">Add new group</span>
    </button>
  </>
);

const ScopeHints: Component = () => (
  <div class="scope-hints" aria-label="Oscilloscope controls">
    <span><kbd>SCROLL</kbd> Amplitude / div</span>
    <span><kbd>⌘</kbd> + <kbd>SCROLL</kbd> Time / div</span>
  </div>
);

// The imaginary part of the analytic signal is the real part shifted by -90°, kept as its own real-valued signal.
const QUADRATURE_OFFSET = -Math.PI / 2;

const ScopeToolbar: Component<{
  mode: AnalyticMode;
  onModeChange: (mode: AnalyticMode) => void;
  onRemove: () => void;
}> = (props) => (
  <header class="scope-toolbar">
    <div class="scope-title">
      <h2>Oscilloscope</h2>
    </div>
    <div class="analyzer-mode" role="radiogroup" aria-label="Analytic signal component">
      <For each={ANALYTIC_MODES}>
        {(option) => (
          <button
            class={`analyzer-toggle ${props.mode === option.value ? "active" : ""}`}
            type="button"
            role="radio"
            aria-checked={props.mode === option.value}
            onClick={() => props.onModeChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
    <button class="icon-button remove-button analyzer-remove" type="button" aria-label="Remove Oscilloscope" onClick={props.onRemove}>×</button>
  </header>
);

const ScopeSettings: Component<{
  settings: ScopeSettings;
  onScaleChange: (axis: keyof ScopeSettings, value: number) => void;
  phaseCoordinates: "cartesian" | "polar";
  onPhaseCoordinatesChange: (coordinates: "cartesian" | "polar") => void;
  phaseUnit: PhaseUnit;
  onPhaseUnitChange: (unit: PhaseUnit) => void;
  showAxes: boolean;
  onShowAxesChange: (visible: boolean) => void;
  showLabels: boolean;
  onShowLabelsChange: (visible: boolean) => void;
  showGridlines: boolean;
  onShowGridlinesChange: (visible: boolean) => void;
}> = (props) => (
  <div class="scope-settings analyzer-settings" role="group" aria-label="Oscilloscope settings">
    <div class="settings-row scope-scale-row">
      <h4 class="settings-row-label">Oscilloscope</h4>
      <label class="scope-scale-readout">
        <span>AMPLITUDE</span>
        <NumericInput
          min={0.001}
          max={100}
          value={props.settings.amplitudePerDivision}
          ariaLabel="Amplitude per division"
          onValue={(value) => props.onScaleChange("amplitudePerDivision", value)}
        />
        <small>/ DIV</small>
      </label>
      <label class="scope-scale-readout">
        <span>TIMEBASE</span>
        <NumericInput
          min={0.001}
          max={100}
          value={props.settings.secondsPerDivision}
          ariaLabel="Time per division"
          onValue={(value) => props.onScaleChange("secondsPerDivision", value)}
        />
        <small>s / DIV</small>
      </label>
    </div>
    <div class="settings-row scope-display-row">
      <label class="scope-visibility-toggle">
        <input
          type="checkbox"
          aria-label="Show axes"
          checked={props.showAxes}
          onChange={(event) => props.onShowAxesChange(event.currentTarget.checked)}
        />
        <span>SHOW AXES</span>
      </label>
      <label class="scope-visibility-toggle">
        <input
          type="checkbox"
          aria-label="Show labels"
          checked={props.showLabels}
          onChange={(event) => props.onShowLabelsChange(event.currentTarget.checked)}
        />
        <span>SHOW LABELS</span>
      </label>
      <label class="scope-visibility-toggle">
        <input
          type="checkbox"
          aria-label="Show gridlines"
          checked={props.showGridlines}
          onChange={(event) => props.onShowGridlinesChange(event.currentTarget.checked)}
        />
        <span>SHOW GRIDLINES</span>
      </label>
    </div>
    <div class="settings-row">
      <h4 class="settings-row-label">Phase plot</h4>
      <div class="scope-coordinate-setting">
        <span>COORDINATES</span>
        <div class="analyzer-mode" role="radiogroup" aria-label="Phase plot coordinates">
          <For each={["cartesian", "polar"] as const}>
            {(coordinates) => (
              <button
                class={`analyzer-toggle ${props.phaseCoordinates === coordinates ? "active" : ""}`}
                type="button"
                role="radio"
                aria-checked={props.phaseCoordinates === coordinates}
                onClick={() => props.onPhaseCoordinatesChange(coordinates)}
              >
                {coordinates === "cartesian" ? "Cartesian" : "Polar"}
              </button>
            )}
          </For>
        </div>
      </div>
      <label>
        <span>UNIT</span>
        <select
          value={props.phaseUnit}
          aria-label="Oscilloscope phase plot units"
          onChange={(event) => props.onPhaseUnitChange(event.currentTarget.value as PhaseUnit)}
        >
          <option value="degrees">Degrees</option>
          <option value="radians">Radians</option>
          <option value="turns">Turns</option>
        </select>
      </label>
    </div>
  </div>
);

type MeterMode = "ratio" | "db" | "log2";

const FULL_SCALE = "full-scale";

const Meter: Component<{ waves: Wave[]; onRemove: () => void }> = (props) => {
  const [mode, setMode] = createSignal<MeterMode>("ratio");
  const [referenceId, setReferenceId] = createSignal(FULL_SCALE);
  const [compareId, setCompareId] = createSignal("");

  createEffect(() => {
    const waves = props.waves;
    if (referenceId() !== FULL_SCALE && !waves.some((wave) => wave.id === referenceId())) setReferenceId(FULL_SCALE);
    if (!waves.some((wave) => wave.id === compareId()) || compareId() === referenceId()) {
      setCompareId(waves.find((wave) => wave.id !== referenceId())?.id ?? "");
    }
  });

  const isFullScale = () => referenceId() === FULL_SCALE;
  const referenceAmplitude = () => isFullScale()
    ? 1
    : Math.abs(props.waves.find((wave) => wave.id === referenceId())?.amplitude ?? 0);
  const compareAmplitude = () => Math.abs(props.waves.find((wave) => wave.id === compareId())?.amplitude ?? 0);

  // Compare signal relative to the reference signal.
  const meterValue = () => {
    const reference = referenceAmplitude();
    const compare = compareAmplitude();
    if (reference === 0) return compare === 0 ? NaN : Infinity;
    const ratio = compare / reference;
    return mode() === "db" ? 20 * Math.log10(ratio) : mode() === "log2" ? Math.log2(ratio) : ratio;
  };

  const meterUnit = () => mode() === "db"
    ? (isFullScale() ? "dBFS" : "dB")
    : mode() === "log2" ? (isFullScale() ? "log2FS" : "bits") : "×";

  const formatMeterValue = () => {
    const value = meterValue();
    if (Number.isNaN(value)) return "—";
    if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞";
    return formatAxisValue(value);
  };

  return (
    <section class="meter" aria-label="Level meter">
      <div class="meter-header">
        <div>
          <h3>Level meter</h3>
        </div>
        <div class="meter-actions">
          <select
            class="meter-mode"
            aria-label="Meter mode"
            value={mode()}
            onChange={(event) => setMode(event.currentTarget.value as MeterMode)}
          >
            <option value="ratio">Ratio</option>
            <option value="db">dB</option>
            <option value="log2">log2 ratio</option>
          </select>
          <button class="icon-button remove-button analyzer-remove" type="button" aria-label="Remove Level meter" onClick={props.onRemove}>×</button>
        </div>
      </div>
      <div class="meter-body">
        <label class="meter-signal">
          <span>Reference signal</span>
          <select
            aria-label="Reference signal"
            value={referenceId()}
            onChange={(event) => setReferenceId(event.currentTarget.value)}
          >
            <option value={FULL_SCALE}>Full Scale</option>
            <For each={props.waves}>
              {(wave) => <option value={wave.id}>{wave.name}</option>}
            </For>
          </select>
        </label>
        <label class="meter-signal">
          <span>Compare signal</span>
          <select
            aria-label="Compare signal"
            value={compareId()}
            onChange={(event) => setCompareId(event.currentTarget.value)}
          >
            <For each={props.waves.filter((wave) => wave.id !== referenceId())}>
              {(wave) => <option value={wave.id}>{wave.name}</option>}
            </For>
          </select>
        </label>
        <output class="meter-value" aria-live="polite">
          <strong>{formatMeterValue()}</strong>
          <small>{meterUnit()}</small>
        </output>
      </div>
    </section>
  );
};

interface PlotCursor {
  left: number;
  top: number;
  xFraction: number;
  yFraction: number;
}

function useDragCrosshair(width: number, height: number) {
  const [crosshair, setCrosshair] = createSignal<{ x: number; y: number }>();
  let activePointerId: number | undefined;

  const update = (event: PointerEvent & { currentTarget: Element }) => {
    if (activePointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setCrosshair({
      x: Math.max(0, Math.min(width, (event.clientX - bounds.left) / bounds.width * width)),
      y: Math.max(0, Math.min(height, (event.clientY - bounds.top) / bounds.height * height)),
    });
  };

  const start = (event: PointerEvent & { currentTarget: Element }) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    update(event);
  };

  const stop = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = undefined;
    setCrosshair();
  };

  return { crosshair, start, update, stop };
}

type AnalyticMode = "real" | "imaginary" | "phase";

const ANALYTIC_MODES: { value: AnalyticMode; label: string }[] = [
  { value: "real", label: "Real" },
  { value: "imaginary", label: "Imaginary" },
  { value: "phase", label: "Phase" },
];

interface SpectrumSeries {
  name: string;
  color: string;
  opacity: number;
  isAnalytic: boolean;
  values: number[];
}

interface LegendItem {
  name: string;
  color: string;
  opacity: number;
}

const AnalyzerLegend: Component<{ items: LegendItem[]; className: string }> = (props) => (
  <div class={props.className}>
    <For each={props.items}>
      {(item) => <span><i style={{ background: item.color, opacity: item.opacity }} />{item.name}</span>}
    </For>
  </div>
);

function calculateDiscreteSpectrum(
  sampleCount: number,
  duration: number,
  window: WindowFunction,
  valueAt: (time: number) => number,
) {
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const windowValue = window === "hann"
      ? 0.5 * (1 - Math.cos(2 * Math.PI * index / (sampleCount - 1)))
      : window === "hamming"
        ? 0.54 - 0.46 * Math.cos(2 * Math.PI * index / (sampleCount - 1))
        : 1;
    return valueAt((index / sampleCount - 0.5) * duration) * windowValue;
  });
  const magnitude: number[] = [];
  const phase: number[] = [];
  for (let bin = 0; bin < sampleCount / 2; bin += 1) {
    let real = 0;
    let imaginary = 0;
    samples.forEach((value, index) => {
      const angle = 2 * Math.PI * bin * index / sampleCount;
      real += value * Math.cos(angle);
      imaginary -= value * Math.sin(angle);
    });
    magnitude.push(Math.min(1, Math.sqrt(real ** 2 + imaginary ** 2) / sampleCount * 2));
    phase.push(Math.atan2(imaginary, real));
  }
  return { magnitude, phase };
}

interface FrequencyPlotProps {
  series: SpectrumSeries[];
  binCount: number;
  maxFrequency: number;
}

const FrequencyMagnitudePlot: Component<FrequencyPlotProps> = (props) => {
  let plot: SVGSVGElement | undefined;
  let animationFrame = 0;
  let pendingPointer: PointerEvent | undefined;
  const [cursor, setCursor] = createSignal<{ x: number; y: number; left: number; top: number; bin: number }>();
  const width = 1000;
  const height = 320;
  const dragCrosshair = useDragCrosshair(width, height);

  const updateCursorNow = (event: PointerEvent) => {
    if (!plot?.parentElement) return;
    const bounds = plot.getBoundingClientRect();
    const wrapperBounds = plot.parentElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const bin = Math.max(0, Math.min(props.binCount - 1, Math.round(x * (props.binCount - 1))));
    const tooltipWidth = 148;
    const tooltipHeight = 40;
    setCursor({
      x: bin / (props.binCount - 1) * width,
      y: y * height,
      bin,
      left: Math.min(wrapperBounds.width - tooltipWidth - 6, Math.max(6, event.clientX - wrapperBounds.left + 14)),
      top: Math.min(bounds.height - tooltipHeight - 6, Math.max(6, event.clientY - wrapperBounds.top - tooltipHeight - 8)),
    });
  };

  const updateCursor = (event: PointerEvent) => {
    pendingPointer = event;
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0;
      const pointer = pendingPointer;
      pendingPointer = undefined;
      if (pointer) updateCursorNow(pointer);
    });
  };

  const updatePointer = (event: PointerEvent & { currentTarget: Element }) => {
    updateCursor(event);
    dragCrosshair.update(event);
  };

  onCleanup(() => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
  });

  return (
    <div class="frequency-plot-wrap">
      <svg
        ref={plot}
        class="frequency-plot"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Frequency domain spectrum"
        onPointerDown={dragCrosshair.start}
        onPointerMove={updatePointer}
        onPointerUp={dragCrosshair.stop}
        onPointerCancel={dragCrosshair.stop}
        onLostPointerCapture={dragCrosshair.stop}
        onPointerLeave={() => setCursor()}
      >
        <defs>
          <pattern id="frequency-grid" width="125" height="80" patternUnits="userSpaceOnUse">
            <path d="M 125 0 L 0 0 0 80" fill="none" stroke="#24373b" stroke-width="1" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="#0b1115" />
        <rect width={width} height={height} fill="url(#frequency-grid)" />
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} class="frequency-axis" />
        <For each={props.series}>
          {(item) => (
            <Show
              when={item.isAnalytic}
              fallback={
                <path
                  d={item.values.map((value, index) => {
                    const x = index / (props.binCount - 1) * width;
                    const y = height - value * (height - 18) - 1;
                    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
                  }).join(" ")}
                  fill="none"
                  stroke={item.color}
                  opacity={item.opacity}
                  class="signal-path"
                />
              }
            >
              <For each={item.values.map((value, index) => ({ value, index })).filter(({ value }) => value > 0)}>
                {({ value, index }) => {
                  const x = index / (props.binCount - 1) * width;
                  return (
                    <line
                      x1={x}
                      y1={height - 1}
                      x2={x}
                      y2={height - value * (height - 18) - 1}
                      stroke={item.color}
                      opacity={item.opacity}
                      class="signal-path"
                    />
                  );
                }}
              </For>
            </Show>
          )}
        </For>
        <For each={[0, 0.5, 1]}>
          {(fraction) => <line x1="0" y1={height - 1 - fraction * (height - 18)} x2={width} y2={height - 1 - fraction * (height - 18)} class="frequency-axis frequency-axis-horizontal" />}
        </For>
        <Show when={dragCrosshair.crosshair()}>
          {(point) => (
            <g class="measurement-crosshair" aria-hidden="true">
              <line x1={point().x} y1="0" x2={point().x} y2={height} />
              <line x1="0" y1={point().y} x2={width} y2={point().y} />
            </g>
          )}
        </Show>
        <text x="8" y="19" class="frequency-title">MAGNITUDE</text>
        <text x="8" y={height / 2} class="axis-tick">0.5</text>
        <text x="8" y={38} class="axis-tick">1</text>
        <text x="8" y={height - 8} class="axis-tick">0 Hz</text>
        <text x={width / 2} y={height - 8} text-anchor="middle" class="axis-tick">{formatAxisValue(props.maxFrequency / 2)} Hz</text>
        <text x={width - 8} y={height - 8} text-anchor="end" class="axis-tick">{formatAxisValue(props.maxFrequency)} Hz</text>
      </svg>
      <Show when={cursor()}>
        {(point) => (
          <div class="frequency-tooltip" aria-hidden="true" style={{ left: `${point().left}px`, top: `${point().top}px` }}>
            <span>f {formatAxisValue(point().bin / (props.binCount - 1) * props.maxFrequency)} Hz</span>
            <span>M {formatAxisValue(props.series[0]?.values[point().bin] ?? 0)}</span>
          </div>
        )}
      </Show>
    </div>
  );
};

interface FrequencyPhasePlotProps extends FrequencyPlotProps {
  phaseUnit: PhaseUnit;
}

const FrequencyPhasePlot: Component<FrequencyPhasePlotProps> = (props) => {
  const [cursor, setCursor] = createSignal<{ left: number; top: number; bin: number; phase: number }>();
  const width = 1000;
  const height = 320;
  const dragCrosshair = useDragCrosshair(width, height);
  const phaseLabel = (fraction: number) => {
    if (fraction === 0) return "0";
    const sign = fraction < 0 ? "-" : "";
    return props.phaseUnit === "degrees" ? `${sign}180°` : props.phaseUnit === "turns" ? `${sign}0.5` : `${sign}π`;
  };
  const formatPhaseValue = (radians: number) => props.phaseUnit === "degrees"
    ? `${formatAxisValue(radians * 180 / Math.PI)}º`
    : props.phaseUnit === "turns"
      ? `${formatAxisValue(radians / (2 * Math.PI))}τ`
      : `${formatAxisValue(radians)} rad`;

  const updatePointer = (event: PointerEvent & { currentTarget: Element }) => {
    const plot = event.currentTarget;
    const bounds = plot.getBoundingClientRect();
    const wrapperBounds = plot.parentElement?.getBoundingClientRect();
    if (!wrapperBounds) return;

    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(height, (event.clientY - bounds.top) / bounds.height * height));
    const bin = Math.max(0, Math.min(props.binCount - 1, Math.round(x * (props.binCount - 1))));
    const phase = Math.max(-Math.PI, Math.min(
      Math.PI,
      (height / 2 - y) / (height / 2 - 18) * Math.PI,
    ));
    const tooltipWidth = 190;
    const tooltipHeight = 48;
    setCursor({
      bin,
      phase,
      left: Math.min(wrapperBounds.width - tooltipWidth - 6, Math.max(6, event.clientX - wrapperBounds.left + 14)),
      top: Math.min(bounds.height - tooltipHeight - 6, Math.max(6, event.clientY - bounds.top - tooltipHeight - 8)),
    });
    dragCrosshair.update(event);
  };

  return (
    <div class="frequency-plot-wrap">
      <svg
        class="frequency-plot phase-plot"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Frequency domain phase spectrum"
        onPointerDown={dragCrosshair.start}
        onPointerMove={updatePointer}
        onPointerUp={dragCrosshair.stop}
        onPointerCancel={dragCrosshair.stop}
        onLostPointerCapture={dragCrosshair.stop}
        onPointerLeave={() => setCursor()}
      >
        <rect width={width} height={height} fill="#0b1115" />
        <rect width={width} height={height} fill="url(#frequency-grid)" />
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} class="frequency-axis" />
        <For each={[0, 0.5, 1]}>
          {(fraction) => <line x1="0" y1={fraction * height} x2={width} y2={fraction * height} class="frequency-axis frequency-axis-horizontal" />}
        </For>
        <Show when={dragCrosshair.crosshair()}>
          {(point) => (
            <g class="measurement-crosshair" aria-hidden="true">
              <line x1={point().x} y1="0" x2={point().x} y2={height} />
              <line x1="0" y1={point().y} x2={width} y2={point().y} />
            </g>
          )}
        </Show>
        <For each={props.series}>
          {(item) => (
            <Show
              when={item.isAnalytic}
              fallback={
                <path
                  d={item.values.map((value, index) => {
                    const x = index / (props.binCount - 1) * width;
                    const y = height / 2 - (value / Math.PI) * (height / 2 - 18);
                    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
                  }).join(" ")}
                  fill="none"
                  stroke={item.color}
                  opacity={item.opacity}
                  class="signal-path"
                />
              }
            >
              <For each={item.values.map((value, index) => ({ value, index })).filter(({ value }) => Number.isFinite(value))}>
                {({ value, index }) => (
                  <circle
                    cx={index / (props.binCount - 1) * width}
                    cy={height / 2 - (value / Math.PI) * (height / 2 - 18)}
                    r="3"
                    fill={item.color}
                    opacity={item.opacity}
                    class="signal-path"
                  />
                )}
              </For>
            </Show>
          )}
        </For>
        <text x="8" y="19" class="frequency-title">PHASE</text>
        <text x="8" y="38" class="axis-tick">{phaseLabel(1)}</text>
        <text x="8" y={height / 2 + 4} class="axis-tick">0</text>
        <text x="8" y={height - 8} class="axis-tick">{phaseLabel(-1)}</text>
        <text x={width - 8} y={height - 8} text-anchor="end" class="axis-tick">{formatAxisValue(props.maxFrequency)} Hz</text>
      </svg>
      <Show when={cursor()}>
        {(point) => (
          <div class="frequency-tooltip phase-tooltip" aria-hidden="true" style={{ left: `${point().left}px`, top: `${point().top}px` }}>
            <span>f {formatAxisValue(point().bin / (props.binCount - 1) * props.maxFrequency)} Hz</span>
            <span>Phase: {formatPhaseValue(point().phase)}</span>
          </div>
        )}
      </Show>
    </div>
  );
};

interface FrequencyAnalyzerSettingsProps {
  settings: FourierSettings;
  onSettingsChange: (settings: FourierSettings) => void;
  phaseUnit: PhaseUnit;
  onPhaseUnitChange: (unit: PhaseUnit) => void;
}

const FrequencyAnalyzerSettings: Component<FrequencyAnalyzerSettingsProps> = (props) => (
  <div class="analyzer-settings">
    <div class="settings-row frequency-settings-row">
      <h4 class="settings-row-label">Frequency plot</h4>
      <label class="fft-size-setting">
        <span>FFT SIZE</span>
        <select
          value={props.settings.sampleCount}
          onChange={(event) => props.onSettingsChange({ ...props.settings, sampleCount: Number(event.currentTarget.value) })}
        >
          <option value="128">128</option>
          <option value="256">256</option>
          <option value="512">512</option>
          <option value="1024">1024</option>
        </select>
      </label>
      <label class="window-duration-setting">
        <span>WINDOW (S)</span>
        <NumericInput
          min={0.001}
          max={100}
          value={props.settings.duration}
          ariaLabel="Fourier analysis window duration"
          onValue={(value) => props.onSettingsChange({ ...props.settings, duration: value })}
        />
      </label>
      <label class="window-function-setting">
        <span>WINDOW FUNCTION</span>
        <select
          value={props.settings.window}
          onChange={(event) => props.onSettingsChange({ ...props.settings, window: event.currentTarget.value as WindowFunction })}
        >
          <option value="rectangular">Rectangular</option>
          <option value="hann">Hann</option>
          <option value="hamming">Hamming</option>
        </select>
      </label>
    </div>
    <div class="settings-row">
      <h4 class="settings-row-label">Phase plot</h4>
      <label>
        <span>UNIT</span>
        <select
          value={props.phaseUnit}
          aria-label="Phase label units"
          onChange={(event) => props.onPhaseUnitChange(event.currentTarget.value as PhaseUnit)}
        >
          <option value="degrees">Degrees</option>
          <option value="radians">Radians</option>
          <option value="turns">Turns</option>
        </select>
      </label>
    </div>
  </div>
);

const FrequencyDomain: Component<{
  waves: Wave[];
  groups: SignalGroup[];
  settings: FourierSettings;
  onSettingsChange: (settings: FourierSettings) => void;
  onRemove: () => void;
}> = (props) => {
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [showFourier, setShowFourier] = createSignal(true);
  const [showAnalytic, setShowAnalytic] = createSignal(false);
  const [phaseUnit, setPhaseUnit] = createSignal<PhaseUnit>("radians");
  const bins = () => props.settings.sampleCount / 2;
  const maxFrequency = () => props.settings.sampleCount / (2 * props.settings.duration);

  const discreteSources = createMemo(() => [
    ...props.waves.filter((wave) => wave.visible).map((wave) => ({
      name: wave.name,
      color: wave.color,
      opacity: wave.opacity,
      valueAt: (time: number) => waveValueAt(wave, time),
    })),
    ...props.groups.filter((group) => group.visible && group.waveIds.length > 0).map((group) => ({
      name: group.name,
      color: group.color,
      opacity: group.opacity,
      valueAt: (time: number) => group.waveIds.reduce((sum, waveId) => {
        const wave = props.waves.find((item) => item.id === waveId);
        return wave ? sum + waveValueAt(wave, time) : sum;
      }, 0),
    })),
  ]);

  const discreteSpectra = createMemo(() => discreteSources().map((source) => {
    const spectrum = calculateDiscreteSpectrum(
      props.settings.sampleCount,
      props.settings.duration,
      props.settings.window,
      source.valueAt,
    );
    return {
      magnitude: {
        name: source.name,
        color: source.color,
        opacity: source.opacity,
        isAnalytic: false,
        values: spectrum.magnitude,
      },
      phase: {
        name: source.name,
        color: source.color,
        opacity: source.opacity,
        isAnalytic: false,
        values: spectrum.phase,
      },
    };
  }));

  const fourierSeries = createMemo(() => discreteSpectra().map((item) => item.magnitude));
  const fourierPhaseSeries = createMemo(() => discreteSpectra().map((item) => item.phase));

  const analyticSpectrumFor = (waves: Wave[]) => {
    const values = Array.from({ length: bins() }, () => 0);
    waves.forEach((wave) => {
      const frequency = Math.abs(wave.frequency);
      const bin = Math.round(frequency / maxFrequency() * (bins() - 1));
      if (bin < values.length) values[bin] = Math.min(1, values[bin] + Math.abs(wave.amplitude));
    });
    return values;
  };

  const analyticSeries = createMemo(() => [
    ...props.waves.filter((wave) => wave.visible).map((wave) => ({
      name: wave.name,
      color: wave.color,
      opacity: wave.opacity,
      isAnalytic: true,
      values: analyticSpectrumFor([wave]),
    })),
    ...props.groups.filter((group) => group.visible && group.waveIds.length > 0).map((group) => ({
      name: group.name,
      color: group.color,
      opacity: group.opacity,
      isAnalytic: true,
      values: analyticSpectrumFor(group.waveIds
        .map((waveId) => props.waves.find((item) => item.id === waveId))
        .filter((wave): wave is Wave => wave !== undefined)),
    })),
  ]);

  const analyticPhaseSeries = createMemo(() => {
    const visibleWaves = props.waves.filter((wave) => wave.visible);
    const visibleGroups = props.groups.filter((group) => group.visible && group.waveIds.length > 0);
    return analyticSeries().map((item, index) => ({
      ...item,
      values: Array.from({ length: bins() }, (_, bin) => {
        if (index < visibleWaves.length) {
          const wave = visibleWaves[index];
          const waveBin = Math.round(Math.abs(wave.frequency) / maxFrequency() * (bins() - 1));
          return waveBin === bin ? phaseToRadians(wave.phase, wave.phaseUnit) : Number.NaN;
        }
        const group = visibleGroups[index - visibleWaves.length];
        const components = group.waveIds
          .map((waveId) => props.waves.find((wave) => wave.id === waveId))
          .filter((wave): wave is Wave => wave !== undefined)
          .filter((wave) => Math.round(Math.abs(wave.frequency) / maxFrequency() * (bins() - 1)) === bin);
        if (components.length === 0) return Number.NaN;
        const real = components.reduce((sum, wave) => sum + Math.abs(wave.amplitude) * Math.cos(phaseToRadians(wave.phase, wave.phaseUnit)), 0);
        const imaginary = components.reduce((sum, wave) => sum + Math.abs(wave.amplitude) * Math.sin(phaseToRadians(wave.phase, wave.phaseUnit)), 0);
        return Math.atan2(imaginary, real);
      }),
    }));
  });

  const series = createMemo(() => [
    ...(showFourier() ? fourierSeries() : []),
    ...(showAnalytic() ? analyticSeries() : []),
  ]);

  const phaseSeries = createMemo(() => [
    ...(showFourier() ? fourierPhaseSeries() : []),
    ...(showAnalytic() ? analyticPhaseSeries() : []),
  ]);

  const legendSeries = createMemo(() => {
    const seen = new Set<string>();
    return series().filter((item) => {
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });
  });

  return (
    <section class="analyzer-panel" aria-label="Frequency domain analyzer">
      <div class="analyzer-heading">
        <div>
          <h3>Frequency domain</h3>
        </div>
        <div class="analyzer-actions">
          <button class={`analyzer-toggle ${showFourier() ? "active" : ""}`} type="button" aria-pressed={showFourier()} onClick={() => setShowFourier(!showFourier())}>Discrete Fourier Transform</button>
          <button class={`analyzer-toggle ${showAnalytic() ? "active" : ""}`} type="button" aria-pressed={showAnalytic()} onClick={() => setShowAnalytic(!showAnalytic())}>Fourier Transform</button>
          <button class="icon-button remove-button analyzer-remove" type="button" aria-label="Remove Frequency domain" onClick={props.onRemove}>×</button>
        </div>
      </div>
      <FrequencyMagnitudePlot
        series={series()}
        binCount={bins()}
        maxFrequency={maxFrequency()}
      />
      <FrequencyPhasePlot
        series={phaseSeries()}
        binCount={bins()}
        maxFrequency={maxFrequency()}
        phaseUnit={phaseUnit()}
      />
      <div class="frequency-footer">
        <AnalyzerLegend items={legendSeries()} className="analyzer-legend" />
        <button
          class="icon-button gear-button frequency-settings-toggle"
          type="button"
          aria-label="Frequency analyzer settings"
          aria-expanded={settingsOpen()}
          onClick={() => setSettingsOpen(!settingsOpen())}
        >
          ⚙
        </button>
      </div>
      <Show when={settingsOpen()}>
        <FrequencyAnalyzerSettings
          settings={props.settings}
          onSettingsChange={props.onSettingsChange}
          phaseUnit={phaseUnit()}
          onPhaseUnitChange={setPhaseUnit}
        />
      </Show>
    </section>
  );
};

const Oscilloscope: Component<OscilloscopeProps> = (props) => {
  let plot: SVGSVGElement | undefined;
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [hintsOpen, setHintsOpen] = createSignal(false);
  const [cursor, setCursor] = createSignal<PlotCursor>();
  const [mode, setMode] = createSignal<AnalyticMode>("real");
  const [phaseCoordinates, setPhaseCoordinates] = createSignal<"cartesian" | "polar">("polar");
  const [phaseUnit, setPhaseUnit] = createSignal<PhaseUnit>("radians");
  const [showAxes, setShowAxes] = createSignal(true);
  const [showLabels, setShowLabels] = createSignal(true);
  const [showGridlines, setShowGridlines] = createSignal(true);
  const width = 1000;
  const height = 600;
  const dragCrosshair = useDragCrosshair(width, height);
  const divisionsX = 10;
  const divisionsY = 6;
  const samples = 1200;
  const legendItems = createMemo(() => [
    ...props.waves.filter((wave) => wave.visible).map(({ name, color, opacity }) => ({ name, color, opacity })),
    ...props.groups
      .filter((group) => group.visible && group.waveIds.length > 0)
      .map(({ name, color, opacity }) => ({ name, color, opacity })),
  ]);
  const isPolarPhase = () => mode() === "phase" && phaseCoordinates() === "polar";
  const formatPhaseAngle = (radians: number) => phaseUnit() === "degrees"
    ? `${formatAxisValue(radians * 180 / Math.PI)}º`
    : phaseUnit() === "turns"
      ? `${formatAxisValue(radians / (2 * Math.PI))}τ`
      : `${formatAxisValue(radians)} rad`;
  const formatPolarAxisAngle = (radians: number) => {
    if (phaseUnit() !== "radians") return formatPhaseAngle(radians);
    if (radians === 0) return "0";
    const piMultiple = radians / Math.PI;
    const absoluteMultiple = Math.abs(piMultiple);
    const label = absoluteMultiple === 0.5
      ? "π/2"
      : absoluteMultiple === 1
        ? "π"
        : `${formatAxisValue(absoluteMultiple)}π`;
    return piMultiple < 0 ? `-${label}` : label;
  };
  const polarCursorArc = (point: { x: number; y: number }) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.hypot(point.x - centerX, point.y - centerY);
    if (radius === 0) return "";
    const angle = Math.atan2(centerY - point.y, point.x - centerX);
    const sweep = angle < 0 ? 1 : 0;
    return `M ${centerX + radius} ${centerY} A ${radius} ${radius} 0 0 ${sweep} ${point.x} ${point.y}`;
  };

  const updateCursor = (event: PointerEvent) => {
    if (!plot || !plot.parentElement) return;
    const plotBounds = plot.getBoundingClientRect();
    const wrapperBounds = plot.parentElement.getBoundingClientRect();
    const xFraction = Math.max(0, Math.min(1, (event.clientX - plotBounds.left) / plotBounds.width));
    const yFraction = Math.max(0, Math.min(1, (event.clientY - plotBounds.top) / plotBounds.height));
    const tooltipWidth = 148;
    const tooltipHeight = 40;
    const pointerX = event.clientX - wrapperBounds.left;
    const pointerY = event.clientY - wrapperBounds.top;
    const top = pointerY < tooltipHeight + 10 ? pointerY + 14 : pointerY - tooltipHeight - 8;

    setCursor({
      left: Math.min(wrapperBounds.width - tooltipWidth - 6, Math.max(6, pointerX + 14)),
      top: Math.min(plotBounds.height - tooltipHeight - 6, Math.max(6, top)),
      xFraction,
      yFraction,
    });

  };

  const startCrosshair = (event: PointerEvent & { currentTarget: Element }) => {
    dragCrosshair.start(event);
    updateCursor(event);
  };

  const updatePlotPointer = (event: PointerEvent & { currentTarget: Element }) => {
    updateCursor(event);
    dragCrosshair.update(event);
  };

  const pathFor = (wave: Wave) => tracePath((time, offset) => waveValueAt(wave, time, offset));

  const groupPathFor = (group: SignalGroup) => tracePath((time, offset) => group.waveIds.reduce((sum, waveId) => {
    const wave = props.waves.find((item) => item.id === waveId);
    return wave ? sum + waveValueAt(wave, time, offset) : sum;
  }, 0));

  // Real and imaginary plot against time; phase plots imaginary against real (a phasor trace).
  const tracePath = (valueAt: (time: number, offset: number) => number) => {
    const secondsVisible = props.settings.secondsPerDivision * divisionsX;
    const amplitudeVisible = props.settings.amplitudePerDivision * divisionsY;
    return Array.from({ length: samples }, (_, index) => {
      const fraction = index / (samples - 1);
      const time = (fraction - 0.5) * secondsVisible;
      const real = valueAt(time, 0);
      const imaginary = valueAt(time, QUADRATURE_OFFSET);
      const x = mode() === "phase" ? width / 2 + (real / amplitudeVisible) * height : fraction * width;
      const amplitude = mode() === "phase" || mode() === "imaginary" ? imaginary : real;
      const y = height / 2 - (amplitude / amplitudeVisible) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  };

  onMount(() => {
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const axis: keyof ScopeSettings = event.metaKey
        ? "secondsPerDivision"
        : "amplitudePerDivision";
      const current = props.settings[axis];
      const next = Math.min(100, Math.max(0.001, current * Math.exp(event.deltaY * 0.001)));
      props.onScaleChange(axis, Number(next.toPrecision(3)));
    };
    plot?.addEventListener("wheel", handleWheel, { passive: false });
    onCleanup(() => plot?.removeEventListener("wheel", handleWheel));
  });

  return (
    <section class="scope-panel">
      <ScopeToolbar mode={mode()} onModeChange={setMode} onRemove={props.onRemove} />
      <div class="plot-wrap">
        <svg
          ref={plot}
          class="plot"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Live signal analyzer graph. Scroll to adjust vertical scale; hold Command while scrolling to adjust time scale."
          onPointerMove={updatePlotPointer}
          onPointerDown={startCrosshair}
          onPointerUp={dragCrosshair.stop}
          onPointerCancel={dragCrosshair.stop}
          onLostPointerCapture={dragCrosshair.stop}
          onPointerLeave={() => {
            if (!dragCrosshair.crosshair()) setCursor();
          }}
        >
          <defs>
            <pattern id="minor-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#17252a" stroke-width="1" />
            </pattern>
            <pattern id="major-grid" width="100" height="100" patternUnits="userSpaceOnUse">
              <rect width="100" height="100" fill="url(#minor-grid)" />
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#24373b" stroke-width="1" />
            </pattern>
            <clipPath id="plot-clip"><rect width={width} height={height} /></clipPath>
          </defs>
          <rect width={width} height={height} fill="#0b1115" />
          <Show when={!isPolarPhase() && showGridlines()}>
            <rect width={width} height={height} fill="url(#major-grid)" />
          </Show>
          <Show when={showAxes()}>
            <line x1="500" y1="0" x2="500" y2={height} class="axis-line" />
            <line x1="0" y1="300" x2={width} y2="300" class="axis-line" />
          </Show>
          <Show when={isPolarPhase() && showGridlines()}>
            <For each={Array.from({ length: divisionsY / 2 }, (_, index) => index + 1)}>
              {(division) => (
                <circle
                  cx={width / 2}
                  cy={height / 2}
                  r={division * height / divisionsY}
                  fill="none"
                  class="polar-gridline"
                />
              )}
            </For>
            <For each={Array.from({ length: 12 }, (_, index) => index * Math.PI / 6)}>
              {(angle) => (
                <line
                  x1={width / 2}
                  y1={height / 2}
                  x2={width / 2 + Math.cos(angle) * height / 2}
                  y2={height / 2 - Math.sin(angle) * height / 2}
                  class="polar-gridline"
                />
              )}
            </For>
          </Show>
          <g clip-path="url(#plot-clip)">
            <For each={props.waves}>
              {(wave) => (
                <Show when={wave.visible}>
                  <path
                    d={pathFor(wave)}
                    fill="none"
                    stroke={wave.color}
                    opacity={wave.opacity}
                    stroke-width={wave.thickness}
                    stroke-dasharray={wave.style === "dashed" ? "10 7" : wave.style === "dotted" ? "2 7" : undefined}
                    stroke-linecap={wave.style === "dotted" ? "round" : "butt"}
                    class="signal-path"
                  />
                </Show>
              )}
            </For>
            <For each={props.groups}>
              {(group) => (
                <Show when={group.visible && group.waveIds.length > 0}>
                  <path
                    d={groupPathFor(group)}
                    fill="none"
                    stroke={group.color}
                    opacity={group.opacity}
                    stroke-width={group.thickness}
                    stroke-dasharray={group.style === "dashed" ? "10 7" : group.style === "dotted" ? "2 7" : undefined}
                    stroke-linecap={group.style === "dotted" ? "round" : "butt"}
                    class="signal-path"
                  />
                </Show>
              )}
            </For>
          </g>
          <Show when={dragCrosshair.crosshair()}>
            {(point) => (
              <Show
                when={isPolarPhase()}
                fallback={
                  <g class="measurement-crosshair" aria-hidden="true">
                    <line x1={point().x} y1="0" x2={point().x} y2={height} />
                    <line x1="0" y1={point().y} x2={width} y2={point().y} />
                  </g>
                }
              >
                <g class="measurement-crosshair polar-measurement-crosshair" aria-hidden="true">
                  <line x1={width / 2} y1={height / 2} x2={point().x} y2={point().y} />
                  <path d={polarCursorArc(point())} fill="none" />
                </g>
              </Show>
            )}
          </Show>
          <Show when={showLabels()}>
          <g aria-hidden="true">
            <Show
              when={isPolarPhase()}
              fallback={
                <For each={Array.from({ length: divisionsY - 1 }, (_, index) => index + 1)}>
                  {(division) => (
                    <text
                      class="axis-tick"
                      x="8"
                      y={division * height / divisionsY}
                      dominant-baseline="middle"
                    >
                      {formatAxisValue((divisionsY / 2 - division) * props.settings.amplitudePerDivision)}
                    </text>
                  )}
                </For>
              }
            >
              <For each={Array.from({ length: divisionsY / 2 }, (_, index) => index + 1)}>
                {(division) => (
                  <text
                    class="axis-tick"
                    x={width / 2 + 6}
                    y={height / 2 - division * height / divisionsY + 14}
                  >
                    {formatAxisValue(division * props.settings.amplitudePerDivision)}
                  </text>
                )}
              </For>
            </Show>
            <Show when={!isPolarPhase()}>
              <For each={Array.from({ length: divisionsX + 1 }, (_, division) => division).filter(
                (division) => mode() === "phase"
                  ? division !== divisionsX / 2 && division % 2 === 0
                  : division % 2 === 0 || division === divisionsX / 2,
              )}>
                {(division) => (
                  <text
                    class="axis-tick"
                    x={division * width / divisionsX + (division === 0 ? 8 : division === divisionsX ? -8 : 0)}
                    y={height - 8}
                    text-anchor={division === 0 ? "start" : division === divisionsX ? "end" : "middle"}
                  >
                    {mode() === "phase"
                      ? formatAxisValue((division - divisionsX / 2) * props.settings.amplitudePerDivision)
                      : formatAxisValue((division - divisionsX / 2) * props.settings.secondsPerDivision)}
                  </text>
                )}
              </For>
            </Show>
            <Show when={isPolarPhase()}>
              <text class="axis-tick" x={width / 2 + height / 2 - 20} y={height / 2 - 8}>{formatPolarAxisAngle(0)}</text>
              <text class="axis-tick" x={width / 2 + 8} y="24">{formatPolarAxisAngle(Math.PI / 2)}</text>
              <text class="axis-tick" x={width / 2 - height / 2 + 8} y={height / 2 - 8}>{formatPolarAxisAngle(Math.PI)}</text>
              <text class="axis-tick" x={width / 2 + 8} y={height - 8}>{formatPolarAxisAngle(-Math.PI / 2)}</text>
            </Show>
          </g>
          </Show>
        </svg>
        <Show when={cursor()}>
          {(point) => (
            <div
              class="cursor-readout"
              aria-hidden="true"
              style={{ left: `${point().left}px`, top: `${point().top}px` }}
            >
              <Show
                when={isPolarPhase()}
                fallback={
                  <>
                    <span>{mode() === "phase" ? "Re" : "t"} {formatAxisValue(mode() === "phase"
                      ? (point().xFraction - 0.5) * divisionsY * props.settings.amplitudePerDivision * width / height
                      : (point().xFraction - 0.5) * divisionsX * props.settings.secondsPerDivision)}{mode() === "phase" ? "" : " s"}</span>
                    <span>{mode() === "phase" ? "Im" : mode() === "imaginary" ? "Im" : "A"} {formatAxisValue((0.5 - point().yFraction) * divisionsY * props.settings.amplitudePerDivision)}</span>
                  </>
                }
              >
                <span>r {formatAxisValue(Math.hypot(
                  (point().xFraction - 0.5) * divisionsY * props.settings.amplitudePerDivision * width / height,
                  (0.5 - point().yFraction) * divisionsY * props.settings.amplitudePerDivision,
                ))}</span>
                <span>θ {formatPhaseAngle(Math.atan2(
                  (0.5 - point().yFraction) * divisionsY * props.settings.amplitudePerDivision,
                  (point().xFraction - 0.5) * divisionsY * props.settings.amplitudePerDivision * width / height,
                ))}</span>
              </Show>
            </div>
          )}
        </Show>
        <Show when={showLabels()}>
          <span class="axis-label y-axis-label">{isPolarPhase() ? "Magnitude" : "Amplitude"}</span>
        </Show>
        <div class="plot-controls">
          <AnalyzerLegend items={legendItems()} className="plot-legend" />
          <button
            class="icon-button gear-button"
            type="button"
            aria-label="Oscilloscope settings"
            aria-expanded={settingsOpen()}
            onClick={() => {
              setSettingsOpen(!settingsOpen());
              setHintsOpen(false);
            }}
          >
            ⚙
          </button>
          <button
            class="icon-button gear-button help-button"
            type="button"
            aria-label="Oscilloscope control hints"
            aria-expanded={hintsOpen()}
            onClick={() => {
              setHintsOpen(!hintsOpen());
              setSettingsOpen(false);
            }}
          >
            ?
          </button>
        </div>
        <Show when={settingsOpen()}>
          <ScopeSettings
            settings={props.settings}
            onScaleChange={props.onScaleChange}
            phaseCoordinates={phaseCoordinates()}
            onPhaseCoordinatesChange={setPhaseCoordinates}
            phaseUnit={phaseUnit()}
            onPhaseUnitChange={setPhaseUnit}
            showAxes={showAxes()}
            onShowAxesChange={setShowAxes}
            showLabels={showLabels()}
            onShowLabelsChange={setShowLabels}
            showGridlines={showGridlines()}
            onShowGridlinesChange={setShowGridlines}
          />
        </Show>
        <Show when={hintsOpen()}>
          <ScopeHints />
        </Show>
      </div>
    </section>
  );
};

const App: Component = () => {
  const saved = loadSavedState();

  const [waves, setWaves] = createSignal(saved.waves);
  const [groups, setGroups] = createSignal(saved.groups);
  const [phaseEditorWaveId, setPhaseEditorWaveId] = createSignal<string>();

  const [settings, setSettings] = createSignal(saved.settings);
  const [fourierSettings, setFourierSettings] = createSignal(saved.fourierSettings);
  const [analyzers, setAnalyzers] = createSignal(saved.analyzers);
  const [addAnalyzerOpen, setAddAnalyzerOpen] = createSignal(false);

  const [nextWaveNumber, setNextWaveNumber] = createSignal(
    saved.waves.reduce((max, wave) => {
      const match = wave.name.match(/^Signal (\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, saved.waves.length) + 1,
  );
  const [nextGroupNumber, setNextGroupNumber] = createSignal(
    saved.groups.reduce((max, group) => {
      const match = group.name.match(/^Group (\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, saved.groups.length) + 1,
  );

  const updateWave = (id: string, changes: Partial<Wave>) =>
    setWaves((current) => current.map((wave) => wave.id === id ? { ...wave, ...changes } : wave));

  const updateGroup = (id: string, changes: Partial<SignalGroup>) =>
    setGroups((current) => current.map((group) => group.id === id ? { ...group, ...changes } : group));

  const updateScale = (axis: keyof ScopeSettings, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    setSettings((current) => ({ ...current, [axis]: Math.min(100, Math.max(0.001, value)) }));
  };

  const addAnalyzer = (analyzer: AnalyzerType) => {
    setAnalyzers((current) => current.includes(analyzer) ? current : [...current, analyzer]);
    setAddAnalyzerOpen(false);
  };

  const removeAnalyzer = (analyzer: AnalyzerType) =>
    setAnalyzers((current) => current.filter((item) => item !== analyzer));

  const addWave = (groupId: string) => {
    const number = nextWaveNumber();
    const wave = createWave(number);
    setWaves((current) => [...current, wave]);
    setGroups((current) => current.map((group) =>
      group.id === groupId ? { ...group, waveIds: [...group.waveIds, wave.id] } : group,
    ));
    setNextWaveNumber(number + 1);
  };

  const addGroup = () => {
    const number = nextGroupNumber();
    setGroups((current) => [...current, createGroup(number)]);
    setNextGroupNumber(number + 1);
  };

  const removeWave = (id: string) => {
    setWaves((current) => current.filter((wave) => wave.id !== id));
    setGroups((current) => current.map((group) => ({
      ...group,
      waveIds: group.waveIds.filter((waveId) => waveId !== id),
    })));
  };

  const removeGroup = (id: string) => {
    const group = groups().find((item) => item.id === id);
    if (!group) return;
    setGroups((current) => current.filter((item) => item.id !== id));
    setWaves((current) => current.filter((wave) => !group.waveIds.includes(wave.id)));
  };

  createEffect(() => {
    const state: SavedState = {
      waves: waves(),
      groups: groups(),
      settings: settings(),
      fourierSettings: fourierSettings(),
      analyzers: analyzers(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Unable to save signal analyzer settings.", error);
    }
  });

  return (
    <main class="app-shell">
      <AppHeader />
      <div class="workspace">
        <aside class="signals-section">
          <SignalsSection
            waves={waves()}
            groups={groups()}
            phaseEditorWaveId={phaseEditorWaveId()}
            onPhaseEditorWaveIdChange={setPhaseEditorWaveId}
            onChange={updateWave}
            onRemove={removeWave}
            onGroupChange={updateGroup}
            onRemoveGroup={removeGroup}
            onAddWave={addWave}
            onAddGroup={addGroup}
          />
        </aside>
        <div class="analyzers-section">
          <div class="section-heading">
            <h1>Analyzers</h1>
          </div>
          <div class="analyzer-list">
            <For each={analyzers()}>
              {(analyzer) => analyzer === "oscilloscope"
                ? <Oscilloscope waves={waves()} groups={groups()} settings={settings()} onScaleChange={updateScale} onRemove={() => removeAnalyzer(analyzer)} />
                : analyzer === "meter"
                  ? <Meter waves={waves()} onRemove={() => removeAnalyzer(analyzer)} />
                  : <FrequencyDomain
                    waves={waves()}
                    groups={groups()}
                    settings={fourierSettings()}
                    onSettingsChange={setFourierSettings}
                    onRemove={() => removeAnalyzer(analyzer)}
                  />}
            </For>
            <button class="add-wave add-analyzer" type="button" onClick={() => setAddAnalyzerOpen(true)}>
              <span>+</span><span class="add-wave-label">Add analyzer</span>
            </button>
          </div>
        </div>
      </div>
      <Show when={addAnalyzerOpen()}>
        <div
          class="analyzer-modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setAddAnalyzerOpen(false);
          }}
        >
          <section
            class="analyzer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-analyzer-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div class="analyzer-modal-heading">
              <h2 id="add-analyzer-title">Add analyzer</h2>
              <button class="icon-button remove-button" type="button" aria-label="Close" onClick={() => setAddAnalyzerOpen(false)}>×</button>
            </div>
            <div class="analyzer-options">
              <For each={ANALYZER_TYPES.filter((analyzer) => !analyzers().includes(analyzer))}>
                {(analyzer) => (
                  <button type="button" class="analyzer-option" onClick={() => addAnalyzer(analyzer)}>
                    <strong>{ANALYZER_LABELS[analyzer]}</strong>
                    <span>{ANALYZER_DESCRIPTIONS[analyzer]}</span>
                  </button>
                )}
              </For>
              <Show when={analyzers().length === ANALYZER_TYPES.length}>
                <p class="analyzer-empty">All analyzers are already added.</p>
              </Show>
            </div>
          </section>
        </div>
      </Show>
    </main>
  );
};

render(() => <App />, document.getElementById("root")!);
