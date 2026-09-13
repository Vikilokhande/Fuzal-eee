"use client";

import React, { useEffect, useState } from "react";
import { getHostPuzzles, uploadPuzzleImage } from "@/lib/fuzal/api";
import type { PuzzleImageDef } from "@/lib/game/types";
import { GameBadge } from "@/components/game/GameBadge";

export function PuzzleLibraryTab({
  onUsePuzzle,
}: {
  onUsePuzzle?: (puzzle: PuzzleImageDef) => void;
}) {
  const [puzzles, setPuzzles] = useState<PuzzleImageDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [puzzleName, setPuzzleName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  // Preview modal
  const [previewPuzzle, setPreviewPuzzle] = useState<PuzzleImageDef | null>(null);

  const fetchPuzzles = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getHostPuzzles();
      setPuzzles(res.puzzles ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load puzzle library");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPuzzles();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFile(file);
    setUploadPreview(URL.createObjectURL(file));
    if (!puzzleName) {
      setPuzzleName(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    setUploadErr(null);
    setUploadStatus("Uploading master original to Supabase Storage…");

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("name", puzzleName.trim());

      setUploadStatus("Generating 2×2 through 8×8 WebP puzzle piece slices…");
      const res = await uploadPuzzleImage(formData);

      if (res.ok) {
        setUploadStatus("✓ PUZZLE READY! Pieces uploaded.");
        setTimeout(() => {
          setShowUpload(false);
          setUploadFile(null);
          setUploadPreview(null);
          setPuzzleName("");
          setUploadStatus(null);
          void fetchPuzzles();
        }, 1200);
      }
    } catch (err: any) {
      setUploadErr(err?.message ?? "Failed to upload image");
      setUploadStatus(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-6 select-none">
      {/* Header Card */}
      <div className="glass p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <GameBadge variant="ready">PUZZLE REPOSITORY</GameBadge>
            <span className="text-xs text-indigo-200/60 font-mono">{puzzles.length} Available Puzzles</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-black text-white uppercase tracking-wider mt-1">
            Puzzle Image Management
          </h2>
          <p className="text-xs sm:text-sm text-indigo-200/70">
            Pre-generated WebP image library. All images support 2×2 up to 8×8 with 0ms runtime overhead.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="btn-primary px-4 py-2.5 text-xs sm:text-sm font-black flex items-center gap-2"
        >
          <span>➕</span>
          <span>Upload Image</span>
        </button>
      </div>

      {/* Library Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400" />
          <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">
            Loading Puzzle Library…
          </p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 p-4 text-center text-xs text-rose-300">
          {error}
        </div>
      ) : puzzles.length === 0 ? (
        <div className="glass p-12 text-center flex flex-col items-center gap-3">
          <span className="text-4xl">🖼️</span>
          <h3 className="font-display text-xl font-bold text-white uppercase">No Puzzles Found</h3>
          <p className="text-xs text-indigo-200/60 max-w-sm">
            Upload a high-resolution square image to automatically generate slices for your arenas.
          </p>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="btn-primary mt-2 px-5 py-2.5 text-xs font-bold"
          >
            Upload First Puzzle
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {puzzles.map((p) => (
            <div
              key={p.id}
              className="glass p-4 flex flex-col justify-between gap-4 rounded-2xl border border-white/10 hover:border-cyan-400/40 transition-all group"
            >
              {/* Image Preview Container */}
              <div
                onClick={() => setPreviewPuzzle(p)}
                className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-900 cursor-pointer border border-white/10"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.name}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                  <span className="text-xs font-bold text-cyan-300">Click to Preview</span>
                </div>
              </div>

              {/* Puzzle Details */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-base font-bold text-white truncate">{p.name}</h4>
                  <span className="font-mono text-[10px] text-indigo-200/50">{p.createdAt}</span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-indigo-200/60 font-mono text-[11px]">
                    Used in {p.usageCount} games
                  </span>
                  <GameBadge variant="grid">2×2 to 8×8 Ready</GameBadge>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setPreviewPuzzle(p)}
                  className="btn-secondary flex-1 py-1.5 text-xs font-bold"
                >
                  Preview
                </button>
                {onUsePuzzle && (
                  <button
                    type="button"
                    onClick={() => onUsePuzzle(p)}
                    className="btn-primary flex-1 py-1.5 text-xs font-bold"
                  >
                    Select
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Image Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="glass max-w-lg w-full p-6 sm:p-8 flex flex-col gap-5 border border-cyan-400/40 shadow-2xl my-auto">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">
                  New Puzzle Image
                </span>
                <h3 className="font-display text-xl font-black text-white uppercase mt-0.5">
                  Upload &amp; Slice Puzzle
                </h3>
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  setShowUpload(false);
                  setUploadFile(null);
                  setUploadPreview(null);
                }}
                className="text-white/60 hover:text-white text-xl p-1 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="flex flex-col gap-4">
              {/* Drop / Select File Box */}
              <div className="relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/20 hover:border-cyan-400/60 bg-slate-900/60 p-6 text-center cursor-pointer transition-colors">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  disabled={uploading}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                {uploadPreview ? (
                  <div className="flex flex-col items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={uploadPreview}
                      alt="Preview"
                      className="h-36 w-36 rounded-xl object-cover border border-cyan-400/40 shadow-lg"
                    />
                    <span className="text-xs text-cyan-300 font-bold">Click or drop to change</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl">📁</span>
                    <p className="text-xs font-bold text-white">Click or Drag Image Here</p>
                    <p className="text-[11px] text-indigo-200/50">PNG, JPEG, or WebP up to 5MB (Square 1:1 recommended)</p>
                  </div>
                )}
              </div>

              {/* Puzzle Name Input */}
              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-xs font-extrabold uppercase tracking-wider text-indigo-200/70">
                  Puzzle Title
                </label>
                <input
                  type="text"
                  required
                  value={puzzleName}
                  disabled={uploading}
                  onChange={(e) => setPuzzleName(e.target.value)}
                  placeholder="e.g. Cyber Dragon"
                  className="w-full rounded-xl border border-white/15 bg-slate-900 px-3.5 py-2.5 text-sm font-bold text-white focus:border-cyan-400 focus:outline-none"
                />
              </div>

              {/* Status / Processing Indicator */}
              {uploadStatus && (
                <div className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 p-3 text-xs font-bold text-cyan-300 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                  <span>{uploadStatus}</span>
                </div>
              )}

              {uploadErr && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/20 p-3 text-xs text-rose-300 font-bold">
                  {uploadErr}
                </div>
              )}

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => setShowUpload(false)}
                  className="btn-secondary flex-1 py-2.5 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!uploadFile || !puzzleName.trim() || uploading}
                  className="btn-primary flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
                      <span>Processing…</span>
                    </>
                  ) : (
                    <span>Upload &amp; Slice</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Puzzle Modal */}
      {previewPuzzle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass max-w-md w-full p-6 flex flex-col items-center gap-4 text-center border border-cyan-400/40 shadow-2xl">
            <h3 className="font-display text-xl font-bold text-white uppercase">
              {previewPuzzle.name}
            </h3>

            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-xl max-w-xs w-full aspect-square bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewPuzzle.url}
                alt={previewPuzzle.name}
                className="h-full w-full object-cover"
              />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              <GameBadge variant="grid">Supports 2×2 through 8×8</GameBadge>
              <GameBadge variant="neutral">Used {previewPuzzle.usageCount} times</GameBadge>
            </div>

            <div className="flex items-center gap-2.5 w-full mt-2">
              <button
                type="button"
                onClick={() => setPreviewPuzzle(null)}
                className="btn-secondary flex-1 py-2 text-xs font-bold"
              >
                Close
              </button>
              {onUsePuzzle && (
                <button
                  type="button"
                  onClick={() => {
                    const p = previewPuzzle;
                    setPreviewPuzzle(null);
                    onUsePuzzle(p);
                  }}
                  className="btn-primary flex-1 py-2 text-xs font-bold"
                >
                  Use for Next Game
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
