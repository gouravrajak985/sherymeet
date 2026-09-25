import React from "react";
import MeetingPageClient from "./MeetingPageClient";
import { Metadata } from "next";

interface Params {
  roomId: string;
}

interface SearchParams {
  token?: string;
  recorder?: string;
}

export const metadata: Metadata = {
  title: "Meeting | 1:1 Meet",
  description: "Join conference room.",
};

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { roomId } = await params;
  const { token, recorder } = await searchParams;
  console.log({ roomId, token, recorder });
  return <MeetingPageClient roomId={roomId} token={token || ""} isRecorder={recorder === "true"} />;
}
