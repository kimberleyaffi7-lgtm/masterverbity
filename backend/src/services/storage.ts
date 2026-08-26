import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  DeleteObjectCommand, GetObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

export const s3 = new S3Client({
  endpoint: config.s3Endpoint,
  region: config.s3Region,
  forcePathStyle: true,
  credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey }
});

export async function startMultipart(key: string, contentType?: string) {
  const r = await s3.send(new CreateMultipartUploadCommand({
    Bucket: config.s3Bucket, Key: key, ContentType: contentType || "application/octet-stream"
  }));
  if (!r.UploadId) throw new Error("Could not create upload");
  return r.UploadId;
}
export async function partUrl(key: string, uploadId: string, partNumber: number) {
  return getSignedUrl(s3, new UploadPartCommand({
    Bucket: config.s3Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber
  }), { expiresIn: 900 });
}
export async function completeMultipart(key: string, uploadId: string, parts: {PartNumber:number;ETag:string}[]) {
  return s3.send(new CompleteMultipartUploadCommand({
    Bucket: config.s3Bucket, Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts.sort((a,b)=>a.PartNumber-b.PartNumber) }
  }));
}
export async function abortMultipart(key: string, uploadId: string) {
  await s3.send(new AbortMultipartUploadCommand({Bucket: config.s3Bucket, Key: key, UploadId: uploadId}));
}
export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({Bucket: config.s3Bucket, Key: key}));
}
export async function downloadObject(key: string) {
  return s3.send(new GetObjectCommand({Bucket: config.s3Bucket, Key: key}));
}
