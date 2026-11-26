import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { CATEGORIES } from '../disputes';
import { shrinkPhoto } from '../lib/photo';
import {
  Button, ErrorNote, Field, Modal, useToast,
} from './ui';

const MAX_PHOTOS = 4;

// Raise a dispute on a request: what went wrong, a description, and up to four photos.
export default function RaiseDisputeModal({ request, onClose }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [category, setCategory] = useState('description');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  function pick(e) {
    const picked = [...e.target.files].filter((f) => f.type.startsWith('image/'));
    setFiles((cur) => [...cur, ...picked].slice(0, MAX_PHOTOS));
    e.target.value = '';
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    let id;
    try {
      const r = await api('/disputes', { method: 'POST', body: { requestId: request._id, category, subject, description } });
      id = r.dispute._id;
    } catch (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    let failed = 0;
    for (const file of files) {
      try {
        const form = new FormData();
        form.append('photo', await shrinkPhoto(file));
        await api(`/disputes/${id}/evidence`, { method: 'POST', form });
      } catch {
        failed += 1;
      }
    }
    toast(failed ? `Dispute raised. ${failed} photo${failed > 1 ? 's' : ''} could not be uploaded, add them on the dispute page.` : 'Dispute raised. The other side has been notified.', failed ? 'error' : 'ok');
    onClose();
    navigate(`/disputes/${id}`);
  }

  return (
    <Modal title="Raise a dispute" onClose={onClose}>
      <p className="mb-4 text-sm text-graphite-600">
        About “{request.listing?.title || 'this trade'}”. The other side is notified and can reply with their own evidence. A resolver reviews both and makes a final decision.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="What is it about?">
          {(id) => (
            <select id={id} className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          )}
        </Field>
        <Field label="Short title">
          {(id) => <input id={id} className="field" maxLength={120} required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Half of the bricks are cracked" />}
        </Field>
        <Field label="What happened?" hint="Say what was agreed and what you found instead.">
          {(id) => <textarea id={id} className="field min-h-28" maxLength={2000} required value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <div>
          <p className="mb-1 text-sm font-semibold text-graphite-800">Photos (optional)</p>
          {previews.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <li key={src} className="relative">
                  <img src={src} alt={`Selected photo ${i + 1}`} className="h-16 w-16 rounded-md border border-slab-300 object-cover" />
                  <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-graphite-900 text-xs text-white">×</button>
                </li>
              ))}
            </ul>
          )}
          {files.length < MAX_PHOTOS && (
            <label className="inline-flex cursor-pointer items-center rounded-md border border-slab-400 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slab-200">
              Add photos
              <input type="file" accept="image/*" multiple className="sr-only" onChange={pick} />
            </label>
          )}
          <p className="mt-1 text-xs text-graphite-500">Up to {MAX_PHOTOS} now. You can add more on the dispute page.</p>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} className="w-full">Raise dispute</Button>
      </form>
    </Modal>
  );
}
