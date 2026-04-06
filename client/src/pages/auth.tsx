import { useState, useEffect, useLayoutEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, User, ArrowRight, Zap, Eye, EyeOff } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { useAuth } from "@/contexts/AuthContext";
import { IOSFeedbackManager } from "@/lib/ios-utils";
import {
  AUTH_SCROLL_CONTAINER_PADDING_BOTTOM,
  AUTH_SCROLL_CONTAINER_PADDING_TOP,
} from "@/lib/auth-screen-layout";
import { useToast } from "@/hooks/use-toast";

const signInSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const signUpSchema = signInSchema.extend({
  fullName: z.string().min(2, "Enter your name").optional(),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type SignInForm = z.infer<typeof signInSchema>;
type SignUpForm = z.infer<typeof signUpSchema>;

const inputClass =
  "w-full bg-surface-raised pl-11 pr-4 py-4 rounded-2xl text-foreground placeholder-muted-foreground outline-none border border-transparent focus:border-skyblue transition-colors shadow-sm text-base";

const passwordInputClass =
  "w-full bg-surface-raised pl-11 pr-12 py-4 rounded-2xl text-foreground placeholder-muted-foreground outline-none border border-transparent focus:border-skyblue transition-colors shadow-sm text-base";

function PasswordField({
  registration,
  placeholder,
  show,
  onToggle,
  autoComplete = "current-password",
}: {
  registration: UseFormRegisterReturn;
  placeholder: string;
  show: boolean;
  onToggle: () => void;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        {...registration}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        className={passwordInputClass}
        autoCapitalize="none"
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => {
          void IOSFeedbackManager.lightImpact();
          onToggle();
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl text-muted-foreground hover:text-foreground/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-skyblue"
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
      >
        {show ? <EyeOff size={20} strokeWidth={2} aria-hidden /> : <Eye size={20} strokeWidth={2} aria-hidden />}
      </button>
    </div>
  );
}

export default function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [showSignInPassword, setShowSignInPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [showSignUpConfirmPassword, setShowSignUpConfirmPassword] = useState(false);
  const [, setLocation] = useLocation();
  const { signIn, signUp, signInWithApple } = useAuth();
  const { toast } = useToast();

  const signInForm = useForm<SignInForm>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const signUpForm = useForm<SignUpForm>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: "", password: "", confirmPassword: "", fullName: "" },
  });

  useEffect(() => {
    setShowSignInPassword(false);
    setShowSignUpPassword(false);
    setShowSignUpConfirmPassword(false);
  }, [mode]);

  /* WKWebView can leave a non-zero scroll offset after keyboard focus; content then sits under the island. */
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [mode]);

  const handleAppleSignIn = async () => {
    setAppleLoading(true);
    await IOSFeedbackManager.mediumImpact();
    const { error } = await signInWithApple();
    setAppleLoading(false);
    if (error) {
      await IOSFeedbackManager.errorNotification();
      toast({ title: "Apple sign in failed", description: error, variant: "destructive" });
    }
  };

  const handleSignIn = async (data: SignInForm) => {
    setLoading(true);
    await IOSFeedbackManager.mediumImpact();
    const { error } = await signIn(data.email, data.password);
    setLoading(false);
    if (error) {
      await IOSFeedbackManager.errorNotification();
      toast({ title: "Sign in failed", description: error, variant: "destructive" });
    } else {
      await IOSFeedbackManager.successNotification();
      setLocation("/");
    }
  };

  const handleSignUp = async (data: SignUpForm) => {
    setLoading(true);
    await IOSFeedbackManager.mediumImpact();
    const { error } = await signUp(data.email, data.password, data.fullName);
    setLoading(false);
    if (error) {
      await IOSFeedbackManager.errorNotification();
      toast({ title: "Sign up failed", description: error, variant: "destructive" });
    } else {
      await IOSFeedbackManager.successNotification();
      /* Email confirmation off in Supabase → session is active; Router sends user to onboarding. */
      setMode("signin");
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start px-6 bg-surface"
      style={{
        minHeight: "100dvh",
        paddingBottom: AUTH_SCROLL_CONTAINER_PADDING_BOTTOM,
        paddingTop: AUTH_SCROLL_CONTAINER_PADDING_TOP,
      }}
    >
      {/*
        No nested overflow-y — document scroll only. WKWebView scrolls focused inputs above
        the keyboard; extra bottom padding is safe-area + small margin only (not 40vh).
      */}
      <div className="w-full">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <div className="flex items-center justify-center mb-3">
            <div className="w-12 h-12 bg-skyblue rounded-2xl flex items-center justify-center shadow-lg">
              <Zap size={22} className="text-white" fill="white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-foreground tracking-tight">Vista</h1>
          <p className="text-muted-foreground mt-1.5 text-base">Your personal AI running coach</p>
        </motion.div>

        {/* Tab Toggle */}
        <div className="w-full bg-surface-raised rounded-2xl p-1 flex mb-6 shadow-sm">
          <button
            onClick={() => { setMode("signin"); IOSFeedbackManager.lightImpact(); }}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${
              mode === "signin" ? "bg-skyblue text-white shadow-sm" : "text-muted-foreground"
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setMode("signup"); IOSFeedbackManager.lightImpact(); }}
            className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${
              mode === "signup" ? "bg-skyblue text-white shadow-sm" : "text-muted-foreground"
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Forms */}
        <AnimatePresence mode="wait">
          {mode === "signin" ? (
            <motion.div
              key="signin"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.18 }}
              className="w-full"
            >
              <form onSubmit={signInForm.handleSubmit(handleSignIn)} className="space-y-3">
                <div>
                  <div className="relative">
                    <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      {...signInForm.register("email")}
                      type="email"
                      placeholder="Email"
                      className={inputClass}
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  </div>
                  {signInForm.formState.errors.email && (
                    <p className="text-red-500 text-xs mt-1 ml-2">{signInForm.formState.errors.email.message}</p>
                  )}
                </div>

                <div>
                  <PasswordField
                    registration={signInForm.register("password")}
                    placeholder="Password"
                    show={showSignInPassword}
                    onToggle={() => setShowSignInPassword((v) => !v)}
                    autoComplete="current-password"
                  />
                  {signInForm.formState.errors.password && (
                    <p className="text-red-500 text-xs mt-1 ml-2">{signInForm.formState.errors.password.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-skyblue text-white py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60 shadow-lg mt-1"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>Sign In <ArrowRight size={18} /></>
                  )}
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="signup"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.18 }}
              className="w-full"
            >
              <form onSubmit={signUpForm.handleSubmit(handleSignUp)} className="space-y-3">
                <div>
                  <div className="relative">
                    <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      {...signUpForm.register("fullName")}
                      type="text"
                      placeholder="Your name"
                      className={inputClass}
                    />
                  </div>
                  {signUpForm.formState.errors.fullName && (
                    <p className="text-red-500 text-xs mt-1 ml-2">{signUpForm.formState.errors.fullName.message}</p>
                  )}
                </div>

                <div>
                  <div className="relative">
                    <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      {...signUpForm.register("email")}
                      type="email"
                      placeholder="Email"
                      className={inputClass}
                      autoCapitalize="none"
                    />
                  </div>
                  {signUpForm.formState.errors.email && (
                    <p className="text-red-500 text-xs mt-1 ml-2">{signUpForm.formState.errors.email.message}</p>
                  )}
                </div>

                <div>
                  <PasswordField
                    registration={signUpForm.register("password")}
                    placeholder="Password (6+ characters)"
                    show={showSignUpPassword}
                    onToggle={() => setShowSignUpPassword((v) => !v)}
                    autoComplete="new-password"
                  />
                  {signUpForm.formState.errors.password && (
                    <p className="text-red-500 text-xs mt-1 ml-2">{signUpForm.formState.errors.password.message}</p>
                  )}
                </div>

                <div>
                  <PasswordField
                    registration={signUpForm.register("confirmPassword")}
                    placeholder="Confirm password"
                    show={showSignUpConfirmPassword}
                    onToggle={() => setShowSignUpConfirmPassword((v) => !v)}
                    autoComplete="new-password"
                  />
                  {signUpForm.formState.errors.confirmPassword && (
                    <p className="text-red-500 text-xs mt-1 ml-2">{signUpForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-skyblue text-white py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-60 shadow-lg mt-1"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>Create Account <ArrowRight size={18} /></>
                  )}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Divider */}
        <div className="flex items-center gap-3 w-full mt-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground font-medium">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Sign in with Apple */}
        <button
          onClick={handleAppleSignIn}
          disabled={appleLoading}
          className="w-full mt-3 bg-black text-white py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-60 shadow-lg"
        >
          {appleLoading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.37.07 2.32.74 3.15.8 1.2-.23 2.35-.91 3.63-.84 1.54.09 2.7.68 3.46 1.83-3.17 1.98-2.42 6.17.76 7.44-.56 1.47-1.3 2.9-3 3.65zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              Sign in with Apple
            </>
          )}
        </button>

        <p className="text-center text-xs text-muted-foreground mt-4 px-4">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
