import { ImageUp, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { Button, ErrorBox, Kpi, Loading, Sheet } from "../components/ui";
import { api, type VisionResult } from "../lib/api";
import { fmt } from "../lib/format";

export default function Scout() {
  const [result, setResult] = useState<VisionResult>();
  const [original, setOriginal] = useState<string>();
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState(12);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lastFile = useRef<Blob>(undefined);

  async function run(file: Blob, g = grid) {
    lastFile.current = file;
    setBusy(true);
    setError(undefined);
    setOriginal((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    try {
      setResult(await api.analyzeImage(file, g));
    } catch (e) {
      setError(e as Error);
      setResult(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function sample() {
    const seed = Math.floor(Math.random() * 1000);
    const blob = await fetch(`/api/vision/sample.png?seed=${seed}`).then((r) => r.blob());
    run(blob);
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="label">No drone? Start here</div>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Photo scout</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-3">
          Upload a top-down photo of a row crop (phone held high, boom camera or low drone pass). Patchwork separates plants from soil with the
          excess-green index, finds the crop rows from their spacing, and marks green growing between the rows as weeds, cell by cell.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) run(f);
        }}
        className={`sheet flex flex-col items-center justify-center gap-3 border-dashed px-6 py-10 text-center transition-colors ${drag ? "bg-lime-2" : ""}`}
      >
        <ImageUp className="text-moss" />
        <p className="text-sm">Drop a JPG or PNG here (up to 12 MB)</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => input.current?.click()}>Choose photo</Button>
          <Button variant="lime" onClick={sample}>
            <Sparkles size={14} /> Try a sample image
          </Button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-3">
          Spray-cell grid
          <input
            type="range"
            min={6}
            max={30}
            value={grid}
            onChange={(e) => setGrid(+e.target.value)}
            onMouseUp={() => lastFile.current && run(lastFile.current)}
            onTouchEnd={() => lastFile.current && run(lastFile.current)}
            onKeyUp={() => lastFile.current && run(lastFile.current)}
          />
          <span className="num">{grid} rows</span>
        </label>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) run(f);
            e.target.value = "";
          }}
        />
      </div>

      {error && <ErrorBox error={error} />}
      {busy && <Loading label="Analysing photo" />}

      {result && !busy && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi tone="moss" label="Weed cover" value={fmt.frac(result.weed_cover, 1)} sub={`crop ${fmt.frac(result.crop_cover, 1)} of image`} />
            <Kpi tone="lime" label="Cells to spray" value={fmt.frac(result.spray_fraction)} sub={`${result.spray_cells} of ${result.grid.rows * result.grid.cols} cells`} />
            <Kpi label="Herbicide saved" value={`−${fmt.pct((1 - result.spray_fraction) * 100)}`} sub="vs spraying the whole frame" />
            <Kpi
              tone="spray"
              label="Crop rows"
              value={result.rows_detected ? result.row_orientation! : "none"}
              sub={result.rows_detected ? `spacing ${result.row_spacing_px} px · signal ${result.row_signal_strength}` : "treating all vegetation as weed"}
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Sheet label="Input" title="Photo">
              {original && <img src={original} alt="Uploaded field photo" className="w-full" />}
            </Sheet>
            <Sheet label="Output" title="Weed map and spray cells">
              <img src={result.overlay_png} alt="Weed detection overlay" className="w-full" />
              <p className="mt-3 text-xs text-ink-3">
                <span className="mr-1 inline-block h-2.5 w-2.5 bg-[#d64828]" /> weed pixels ·{" "}
                <span className="mr-1 inline-block h-2.5 w-2.5 bg-lime" /> crop · outlined squares are spray cells (&gt;1.5% weed cover).
              </p>
            </Sheet>
          </div>
        </>
      )}
    </div>
  );
}
