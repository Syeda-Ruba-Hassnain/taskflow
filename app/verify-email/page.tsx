import VerifyEmailClient from "./verify-email-client";

type VerifyEmailPageProps = {
  searchParams: Promise<{
    [key: string]: string | string[] | undefined;
  }>;
};

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const params = await searchParams;
  const tokenParam = params.token;
  const token =
    typeof tokenParam === "string" ? tokenParam : null;

  return <VerifyEmailClient token={token} />;
}
