"use client";

import BrandMark from "@/components/BrandMark";
import BrandSettings from "@/components/BrandSettings";
import { adminAction } from "@/lib/adminApi";
import type { BrandInfo } from "@/lib/useBrand";
import { useState } from "react";

type Props = {
  brand: BrandInfo;
  defaultPin: boolean;
  onBrandSaved: (brand: BrandInfo) => void;
  notify: (text: string, tone?: "ok" | "warn") => void;
  onLogout: () => void;
};

export default function SettingsPanel({ brand, defaultPin, onBrandSaved, notify, onLogout }: Props) {
  const [brandOpen, setBrandOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);

  const changePin = async () => {
    if (newPin.length < 4 || newPin.length > 8 || !/^\d+$/.test(newPin)) {
      notify("New PIN must be 4–8 digits", "warn");
      return;
    }
    if (newPin !== confirmPin) {
      notify("The two new PINs do not match", "warn");
      return;
    }
    setBusy(true);
    const result = await adminAction({ action: "change-pin", currentPin, newPin });
    setBusy(false);
    if (!result.ok) {
      notify(result.error ?? "Could not change PIN", "warn");
      return;
    }
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    notify("PIN changed — remember the new one!");
  };

  const input = "w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-sm tracking-[0.3em] outline-none focus:border-fuchsia-400";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-3 text-sm font-bold">Ministry branding</h3>
        <BrandMark brand={brand} size="lg" />
        <p className="mt-3 text-xs text-white/50">
          Logo, ministry name and tagline used across the app, banners and shared links.
        </p>
        <button onClick={() => setBrandOpen(true)} className="mt-3 rounded-full bg-gradient-to-r from-fuchsia-500 to-rose-500 px-5 py-2.5 text-sm font-bold">
          Edit logo & name
        </button>
        <BrandSettings open={brandOpen} brand={brand} onClose={() => setBrandOpen(false)} onSaved={onBrandSaved} />
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-1 text-sm font-bold">Admin PIN</h3>
        {defaultPin && (
          <p className="mb-3 rounded-xl bg-amber-500/15 px-3 py-2 text-[11px] text-amber-100">
            You are still using the starting PIN <span className="font-mono font-bold">7772</span>. Change it so only you can open this dashboard.
          </p>
        )}
        <div className="space-y-2">
          <input value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="Current PIN" className={input} />
          <input value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="New PIN (4–8 digits)" className={input} />
          <input value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="Repeat new PIN" className={input} />
          <button onClick={changePin} disabled={busy || !currentPin || !newPin} className="w-full rounded-full bg-white/15 py-2.5 text-sm font-semibold hover:bg-white/25 disabled:opacity-40">
            {busy ? "Saving…" : "Change PIN"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
        <h3 className="mb-2 text-sm font-bold">Session</h3>
        <p className="text-xs text-white/50">You stay signed in on this device for 12 hours. Sign out when you use a shared computer.</p>
        <button onClick={onLogout} className="mt-3 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-rose-300 hover:bg-white/20">
          Sign out of admin
        </button>
      </section>
    </div>
  );
}
