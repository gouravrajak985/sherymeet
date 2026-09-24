import {
  EgressClient,
  EncodedFileOutput,
  S3Upload,
  EncodingOptions,
  EgressInfo,
  EgressStatus,
  AccessToken,
} from "livekit-server-sdk";
import { config } from "../../utils/config";
import { logger } from "@/server/utils/logger";
import { ApiError } from "@/server/utils/api-helper";

async function generateRecorderToken(roomName: string): Promise<string> {
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: `recorder-${roomName}`,
    name: "Recording Bot",
    ttl: "24h",
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: false,
    canSubscribe: true,
    canPublishData: false,
    hidden: true,
    recorder: true,
  });
  return await at.toJwt();
}

export async function startRoomRecording(
  roomName: string,
  filepath: string,
): Promise<EgressInfo | null> {
  const host = config.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://");
  const client = new EgressClient(host, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

  if (!config.AWS_ACCESS_KEY_ID || !config.AWS_SECRET_ACCESS_KEY) {
    if (config.NODE_ENV === "production") {
      throw new Error("AWS S3 configuration is missing. Recording cannot be started.");
    }
    logger.error("AWS S3 configuration is missing. skipping the recording.");
    return null;
  }

  // Generate a recorder token for the custom web page
  const recorderToken = await generateRecorderToken(roomName);
  const baseUrl = config.RECORDING_BASE_URL || config.NEXT_PUBLIC_API_URL;
  const recordingUrl = `${baseUrl}/meet/${roomName}?recorder=true&token=${recorderToken}`;

  logger.info(`Starting web egress for room ${roomName}`, { recordingUrl: recordingUrl });

  // Use web egress to record the custom recorder view
  const egressInfo = await client.startWebEgress(
    recordingUrl,
    new EncodedFileOutput({
      filepath: filepath,
      output: {
        case: "s3",
        value: new S3Upload({
          accessKey: config.AWS_ACCESS_KEY_ID,
          secret: config.AWS_SECRET_ACCESS_KEY,
          region: config.AWS_S3_REGION,
          bucket: config.AWS_S3_BUCKET_NAME,
        }),
      },
    }),
    {
      encodingOptions: new EncodingOptions({
        width: 1920,
        height: 1080,
        framerate: 30,
        videoBitrate: 6000,
        audioBitrate: 256,
      }),
    },
  );
  return egressInfo;
}

export async function stopEgress(egressId: string): Promise<EgressInfo> {
  const host = config.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://");
  const client = new EgressClient(host, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  const egresses = await client.listEgress({
    egressId,
  });
  const egress = egresses[0];
  if (!egress) {
    throw new ApiError(`Egress with ID ${egressId} not found`, 404);
  }
  if (egress.status === EgressStatus.EGRESS_ENDING) {
    throw new ApiError(`Egress with ID ${egressId} is already ending`, 409);
  }
  const egressInfo = await client.stopEgress(egressId);
  return egressInfo;
}
