export function referralSponsorFromParam(value: string | undefined) {
  const sponsor = value?.trim() || "";
  return /^0x[a-fA-F0-9]{40}$/.test(sponsor) ? sponsor : "";
}
