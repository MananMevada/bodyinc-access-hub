import { toastError } from "@/lib/toast-message";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  sendLoginOtp,
  signInWithPassword,
  verifyLoginOtp,
  type SignInResult,
} from "@/lib/auth.functions";
import { clearOtpLogin, clearPasswordRecoveryPending, markOtpLogin } from "@/lib/password-recovery";
import {
  adminLabel,
  adminInput,
  adminCard,
  adminBtnPrimary,
  adminSectionTitle,
  adminSectionSubtitle,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign In — Body Inc" },
      { name: "description", content: "Sign in to the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const passwordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const emailOnlySchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
});

const otpSlotClass =
  "h-10 w-9 border border-[#D5DEDD] bg-white text-[16px] font-medium text-[#3B4759] shadow-none first:rounded-l-[6px] first:border-l last:rounded-r-[6px] ring-[#6A9B9C]";

function AuthPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const signInPw = useServerFn(signInWithPassword);
  const sendOtp = useServerFn(sendLoginOtp);
  const verifyOtp = useServerFn(verifyLoginOtp);

  const [portalError, setPortalError] = useState<{
    message: string;
    redirectUrl?: string;
  } | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwErrors, setPwErrors] = useState<{ email?: string; password?: string }>({});

  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpStage, setOtpStage] = useState<"request" | "verify">("request");
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpEmailError, setOtpEmailError] = useState<string | undefined>();

  useEffect(() => {
    const url = new URL(window.location.href);
    const isRecovery =
      url.searchParams.get("type") === "recovery" ||
      url.searchParams.has("token_hash") ||
      url.hash.includes("type=recovery");
    if (!isRecovery) return;
    const target = new URL("/reset-password", url.origin);
    url.searchParams.forEach((value, key) => target.searchParams.set(key, value));
    target.hash = url.hash;
    window.location.replace(`${target.pathname}${target.search}${target.hash}`);
  }, []);

  async function handleSession(result: SignInResult, source: "password" | "otp" = "password") {
    if (!result.ok) {
      if (result.error === "wrong_portal" || result.error === "no_access") {
        setPortalError({ message: result.message, redirectUrl: result.redirectUrl });
      } else {
        toast.error(result.message);
      }
      return;
    }
    if (source === "otp") markOtpLogin();
    else clearOtpLogin();
    clearPasswordRecoveryPending();
    const { error } = await supabase.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token,
    });
    if (error) {
      clearOtpLogin();
      toast.error("Could not start your session. Please try again.");
      return;
    }
    await router.invalidate();
    navigate({
      to: result.role === "admin" ? "/admin" : result.role === "provider" ? "/provider" : "/dashboard",
    });
  }

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPwErrors({});
    setPortalError(null);

    const parsed = passwordSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errs: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as "email" | "password";
        if (!errs[k]) errs[k] = issue.message;
      }
      setPwErrors(errs);
      return;
    }

    setPwSubmitting(true);
    try {
      const result = await signInPw({ data: parsed.data });
      await handleSession(result);
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setPwSubmitting(false);
    }
  }

  async function onSendOtp(e: FormEvent) {
    e.preventDefault();
    setOtpEmailError(undefined);
    setPortalError(null);

    const parsed = emailOnlySchema.safeParse({ email: otpEmail });
    if (!parsed.success) {
      setOtpEmailError(parsed.error.issues[0]?.message ?? "Enter a valid email");
      return;
    }
    setOtpSubmitting(true);
    try {
      const result = await sendOtp({
        data: { email: parsed.data.email, origin: window.location.origin },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (result.delivery === "link") {
        toast.success("Check your email for a sign-in link.");
        return;
      }
      setOtpStage("verify");
      toast.success("If an account exists, a sign-in code was sent.");
    } catch (err) {
      console.error(err);
      toast.error("Could not send code. Please try again.");
    } finally {
      setOtpSubmitting(false);
    }
  }

  async function onVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setPortalError(null);
    if (otpCode.length < 6) {
      toast.error("Enter the code from the email.");
      return;
    }
    setOtpSubmitting(true);
    try {
      const result = await verifyOtp({
        data: { email: otpEmail, token: otpCode },
      });
      await handleSession(result, "otp");
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setOtpSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 py-12 font-['DM_Sans',sans-serif]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap');
      `}</style>

      <Card className={`${adminCard} w-full max-w-md`}>
        <CardHeader className="space-y-3 p-4 text-center sm:p-6">
          <img
            src="/logo.svg"
            alt="Body Inc"
            className="mx-auto h-auto max-h-[48px] w-full max-w-[160px] object-contain"
          />
          <CardTitle className={adminSectionTitle}>Sign In</CardTitle>
          <CardDescription className={adminSectionSubtitle}>
            Body Inc — Practitioner & Admin portal
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <Tabs defaultValue="password" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-[10px] border border-[#D5DEDD] bg-[#F2F7F6] p-1">
              <TabsTrigger
                value="password"
                className="rounded-[8px] px-3 py-2 text-[14px] font-medium text-[#3B4759] shadow-none data-[state=active]:bg-white data-[state=active]:text-[#3B4759] data-[state=active]:shadow-sm"
              >
                Password
              </TabsTrigger>
              <TabsTrigger
                value="otp"
                className="rounded-[8px] px-3 py-2 text-[14px] font-medium text-[#3B4759] shadow-none data-[state=active]:bg-white data-[state=active]:text-[#3B4759] data-[state=active]:shadow-sm"
              >
                Email OTP
              </TabsTrigger>
            </TabsList>

            <TabsContent value="password" className="mt-5">
              <form onSubmit={onPasswordSubmit} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="email" className={adminLabel}>
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={pwSubmitting}
                    required
                    className={adminInput}
                  />
                  {pwErrors.email && <p className="text-sm text-destructive">{pwErrors.email}</p>}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="password" className={adminLabel}>
                      Password
                    </Label>
                    <Link
                      to="/forgot-password"
                      className="text-[13px] font-medium text-[#6A9B9C] underline-offset-4 hover:text-[#5B8788] hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pwSubmitting}
                    required
                    className={adminInput}
                  />
                  {pwErrors.password && (
                    <p className="text-sm text-destructive">{pwErrors.password}</p>
                  )}
                </div>

                {portalError && <PortalErrorBox error={portalError} />}

                <Button type="submit" className={`${adminBtnPrimary} w-full`} disabled={pwSubmitting}>
                  {pwSubmitting ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="otp" className="mt-5">
              {otpStage === "request" ? (
                <form onSubmit={onSendOtp} className="space-y-4" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="otp-email" className={adminLabel}>
                      Email
                    </Label>
                    <Input
                      id="otp-email"
                      type="email"
                      autoComplete="email"
                      value={otpEmail}
                      onChange={(e) => setOtpEmail(e.target.value)}
                      disabled={otpSubmitting}
                      required
                      className={adminInput}
                    />
                    {otpEmailError && <p className="text-sm text-destructive">{otpEmailError}</p>}
                  </div>
                  {portalError && <PortalErrorBox error={portalError} />}
                  <Button
                    type="submit"
                    className={`${adminBtnPrimary} w-full`}
                    disabled={otpSubmitting}
                  >
                    {otpSubmitting ? "Sending…" : "Send code"}
                  </Button>
                </form>
              ) : (
                <form onSubmit={onVerifyOtp} className="space-y-4" noValidate>
                  <div className="space-y-3">
                    <Label className={`${adminLabel} break-words leading-[140%]`}>
                      Enter the 8-digit code sent to {otpEmail}
                    </Label>
                    <div className="flex justify-center overflow-x-auto py-1">
                      <InputOTP
                        maxLength={8}
                        value={otpCode}
                        onChange={(v) => setOtpCode(v.replace(/\D/g, "").slice(0, 8))}
                        pasteTransformer={(pasted) => pasted.replace(/\D/g, "").slice(0, 8)}
                        disabled={otpSubmitting}
                        containerClassName="gap-1.5 sm:gap-2"
                      >
                        <InputOTPGroup className="gap-0">
                          {Array.from({ length: 8 }).map((_, i) => (
                            <InputOTPSlot key={i} index={i} className={otpSlotClass} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                  </div>

                  {portalError && <PortalErrorBox error={portalError} />}

                  <Button
                    type="submit"
                    className={`${adminBtnPrimary} w-full`}
                    disabled={otpSubmitting}
                  >
                    {otpSubmitting ? "Verifying…" : "Verify & sign in"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setOtpStage("request");
                      setOtpCode("");
                      setPortalError(null);
                    }}
                    className="block w-full text-center text-[13px] font-medium text-[#6A9B9C] underline-offset-4 hover:text-[#5B8788] hover:underline"
                  >
                    Use a different email
                  </button>
                </form>
              )}
            </TabsContent>
          </Tabs>

          <p className="mt-6 text-center text-[12px] font-medium text-[#3B4759]/60">
            Accounts are created by your administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PortalErrorBox({ error }: { error: { message: string; redirectUrl?: string } }) {
  return (
    <div className="rounded-[10px] border border-[#B8684B]/40 bg-[#FBF1EC] p-3 text-sm">
      <p className="font-medium text-[#3B4759]">{error.message}</p>
      {error.redirectUrl && (
        <a
          href={error.redirectUrl}
          className="mt-2 inline-block font-semibold text-[#B8684B] underline-offset-4 hover:underline"
        >
          Go to the correct portal →
        </a>
      )}
    </div>
  );
}
