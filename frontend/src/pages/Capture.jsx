import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, inr, kg } from '../api';
import { useAuth } from '../auth';
import { MATERIAL_NAMES, SalvageTag, Swatch } from '../components/MaterialTag';
import { Button, ErrorNote, Field, PageHeader, useToast } from '../components/ui';
import { shrinkPhoto } from '../lib/photo';

const ACTIONS = ['Reuse', 'Sell', 'Recycle', 'Dispose'];

function ScoreBars({ scores, chosen }) {
  const entries = ACTIONS.filter((a) => scores?.[a] != null);
  if (!entries.length) return null;
  return (
    <dl className="space-y-1.5">
      {entries.map((a) => (
        <div key={a} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 text-sm">
          <dt className={a === chosen ? 'font-bold' : 'text-graphite-600'}>{a}</dt>
          <dd className="h-2 rounded-full bg-slab-200" aria-hidden>
            <div className={`h-2 rounded-full ${a === chosen ? 'bg-verdigris-600' : 'bg-graphite-400'}`} style={{ width: `${Math.max(scores[a] * 100, 2)}%` }} />
          </dd>
          <dd className="figure text-right text-graphite-600">{Math.round(scores[a] * 100)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Capture() {
  const { meta } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [quantityKg, setQuantityKg] = useState('500');
  const [stage, setStage] = useState('photo'); // photo -> review
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiNote, setAiNote] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [form, setForm] = useState({ title: '', materialType: '', conditionScore: 70, notes: '' });
  const [estimate, setEstimate] = useState(null);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  function pick(f) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setError('');
  }

  async function analyze() {
    if (!file) return setError('Choose a photo first.');
    setBusy(true);
    setError('');
    const body = new FormData();
    body.append('image', await shrinkPhoto(file));
    body.append('quantityKg', quantityKg || '100');
    try {
      const r = await api('/ai/analyze', { method: 'POST', form: body });
      const a = r.analysis;
      setAnalysis(a);
      setImageUrl(r.imageUrl);
      // a.material is null when the trained model wasn't sure: the user must pick it
      setForm({ title: a.material ? `${MATERIAL_NAMES[a.material]} from site` : 'Site material', materialType: a.material || '', conditionScore: Math.round(a.condition_score), notes: '' });
      setEstimate(a.material ? { price: a.price, recommendation: a.recommendation, conditionLabel: a.condition_label } : null);
      setAiNote('');
    } catch (err) {
      if (err.status === 503 && err.body?.imageUrl) {
        // AI is offline: keep the photo and let the user fill in details by hand.
        setImageUrl(err.body.imageUrl);
        setAnalysis(null);
        setAiNote(err.message);
        // never pre-select a material the AI didn't suggest
        setForm((f) => ({ ...f, title: f.title || 'Site material', materialType: '' }));
        setEstimate(null);
      } else {
        setError(err.message);
        setBusy(false);
        return;
      }
    }
    setStage('review');
    setBusy(false);
  }

  // Re-estimate when the user corrects material, condition or quantity.
  useEffect(() => {
    if (stage !== 'review' || !form.materialType) return undefined;
    const t = setTimeout(() => {
      api('/ai/estimate', { method: 'POST', body: { material: form.materialType, conditionScore: form.conditionScore, quantityKg: Number(quantityKg) || 100 } })
        .then(setEstimate).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [stage, form.materialType, form.conditionScore, quantityKg]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api('/materials', {
        method: 'POST',
        body: {
          ...form,
          quantityKg: Number(quantityKg),
          imageUrl,
          estimatedPrice: estimate?.price?.price,
          chosenAction: estimate?.recommendation?.action,
          ai: analysis ? {
            material: analysis.material,
            confidence: analysis.confidence,
            model: analysis.model,
            demoMode: analysis.demo_mode,
            conditionScore: analysis.condition_score,
            recommendedAction: analysis.recommendation?.action,
            suggestedPrice: estimate?.price?.price,
          } : undefined,
        },
      });
      toast('Saved to inventory');
      navigate('/inventory');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function reset() {
    setStage('photo');
    setFile(null);
    setPreview(null);
    setAnalysis(null);
    setImageUrl(null);
    setAiNote('');
  }

  const rec = estimate?.recommendation;
  const price = estimate?.price;

  return (
    <>
      <PageHeader title="Capture material">
        Photograph one type of material at a time. The AI suggests what it is, its condition, a price and what to do with it. You can correct anything before saving.
      </PageHeader>

      {stage === 'photo' && (
        <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
            className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg border-2 border-dashed border-slab-400 bg-white text-graphite-500 hover:border-verdigris-600"
          >
            {preview ? <img src={preview} alt="Selected material" className="h-full w-full object-cover" /> : (
              <span className="px-6 text-center">
                <span className="block text-lg font-semibold text-graphite-800">Take or choose a photo</span>
                <span className="block text-sm">JPG, PNG or WEBP up to 8 MB. Daylight and a single material work best.</span>
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} aria-label="Material photo" />
          <div className="space-y-4">
            <Field label="Approximate quantity (kg)" hint="A rough figure is fine. 1 tonne = 1000 kg.">
              {(id) => <input id={id} type="number" min="1" step="any" inputMode="decimal" className="field" value={quantityKg} onChange={(e) => setQuantityKg(e.target.value)} />}
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <Button size="lg" className="w-full" onClick={analyze} busy={busy} disabled={!file}>Analyse photo</Button>
            {preview && <Button variant="ghost" className="w-full" onClick={() => fileRef.current?.click()}>Choose a different photo</Button>}
          </div>
        </div>
      )}

      {stage === 'review' && (
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-4">
            {preview && <img src={preview} alt="Analysed material" className="aspect-[4/3] w-full rounded-lg object-cover" />}
            {analysis?.demo_mode && (
              <p className="rounded-md border border-tag-400 bg-tag-300/30 p-3 text-sm">
                <strong>Demo mode.</strong> No trained model is installed, so material type comes from a colour and texture heuristic ({Math.round(analysis.confidence * 100)}% confidence). Check it carefully.
              </p>
            )}
            {analysis && !analysis.demo_mode && analysis.material && !analysis.needs_confirmation && (
              <p className="rounded-md border border-verdigris-300 bg-verdigris-50 p-3 text-sm">
                <strong>Trained model:</strong> {MATERIAL_NAMES[analysis.material]}, {Math.round(analysis.confidence * 100)}% confident{analysis.detections ? ` (${analysis.detections} pieces detected)` : ''}.
              </p>
            )}
            {analysis && !analysis.demo_mode && analysis.material && analysis.needs_confirmation && (
              <p className="rounded-md border border-tag-400 bg-tag-300/30 p-3 text-sm">
                <strong>Best guess: {MATERIAL_NAMES[analysis.material]}</strong> ({Math.round(analysis.confidence * 100)}%).{' '}
                {analysis.basis === 'classifier-only' && 'The detector found no individual pieces, so this comes from the whole photo only. '}
                {analysis.basis === 'models-disagree' && 'The two models disagree about this photo. '}
                Please confirm or correct the material on the right.
              </p>
            )}
            {analysis?.needs_manual && (
              <p className="rounded-md border border-tag-400 bg-tag-300/30 p-3 text-sm">
                <strong>The model couldn&apos;t tell what this is</strong> ({analysis.reason}). Pick the material on the right
                {analysis.alternatives?.length ? `; its best guess was ${MATERIAL_NAMES[analysis.alternatives[0].material]}` : ''}.
              </p>
            )}
            {aiNote && <p className="rounded-md border border-tag-400 bg-tag-300/30 p-3 text-sm">{aiNote}</p>}
            {analysis && (
              <div className="panel p-4 text-sm">
                <p className="font-semibold">Condition notes</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-graphite-600">
                  {analysis.condition_notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
                {!!analysis.alternatives?.length && (
                  <p className="mt-3 text-graphite-500">
                    Other possibilities: {analysis.alternatives.filter((a) => a.score > 0.05).map((a) => MATERIAL_NAMES[a.material]).join(', ') || 'none likely'}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-5">
            {form.materialType && <SalvageTag material={form.materialType} title={form.title} quantityKg={Number(quantityKg) || 0} conditionScore={form.conditionScore} conditionLabel={estimate?.conditionLabel} price={price?.price}>
              {price && <p className="mt-1 text-sm">Likely range {inr(price.low)} to {inr(price.high)} ({inr(price.per_kg)}/kg, {price.model === 'backend-fallback' ? 'built-in price index' : `${price.model} model`})</p>}
            </SalvageTag>}
            {!form.materialType && (
              <div className="panel p-5">
                <p className="font-semibold">Choose the material below</p>
                <p className="mt-1 text-sm text-graphite-600">The price estimate and suggested action appear once you pick what this is.</p>
              </div>
            )}

            {rec && (
              <div className="panel p-4">
                <p className="text-sm text-graphite-500">Suggested action</p>
                <p className="condensed text-2xl font-bold">{rec.action}</p>
                {!!rec.reasons?.length && <p className="mb-3 text-sm text-graphite-600">{rec.reasons.map((r) => r[0].toUpperCase() + r.slice(1)).join('. ')}.</p>}
                <ScoreBars scores={rec.scores} chosen={rec.action} />
                <p className="mt-3 text-sm text-graphite-600">
                  {rec.action === 'Dispose' ? 'No landfill diversion.' : `Keeps ${kg(rec.landfill_diverted_kg)} out of landfill and avoids about ${kg(rec.co2_saved_kg)} CO₂e (estimate).`}
                </p>
              </div>
            )}

            <div className="space-y-4">
              <Field label="Title">{(id) => <input id={id} className="field" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
              <fieldset>
                <legend className="mb-1 text-sm font-semibold">Material {analysis?.material && <span className="font-normal text-graphite-500">(AI said {MATERIAL_NAMES[analysis.material]})</span>}</legend>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(meta.materials || MATERIAL_NAMES).map((m) => (
                    <label key={m} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${form.materialType === m ? 'border-verdigris-600 bg-verdigris-50 text-verdigris-800' : 'border-slab-400 bg-white'}`}>
                      <input type="radio" name="material" value={m} checked={form.materialType === m} onChange={() => setForm({ ...form, materialType: m })} className="sr-only" />
                      <Swatch material={m} />{MATERIAL_NAMES[m]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Condition: ${form.conditionScore}/100`}>
                  {(id) => <input id={id} type="range" min="0" max="100" className="w-full accent-verdigris-600" value={form.conditionScore} onChange={(e) => setForm({ ...form, conditionScore: Number(e.target.value) })} />}
                </Field>
                <Field label="Quantity (kg)">
                  {(id) => <input id={id} type="number" min="1" step="any" className="field" value={quantityKg} onChange={(e) => setQuantityKg(e.target.value)} />}
                </Field>
              </div>
              <Field label="Notes (optional)" hint="Dimensions, grade, where it is on site, pickup access…">
                {(id) => <textarea id={id} rows={3} className="field" maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}
              </Field>
            </div>
            <ErrorNote>{error}</ErrorNote>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={save} busy={busy} disabled={!form.title || !form.materialType || !(Number(quantityKg) > 0)}>Save to inventory</Button>
              <Button size="lg" variant="secondary" onClick={reset}>Start over</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
