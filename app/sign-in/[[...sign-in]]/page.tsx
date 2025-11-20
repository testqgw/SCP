import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="p-4">
        {/* ✅ FIX: Use forceRedirectUrl instead of the old props */}
        <SignIn 
          path="/sign-in" 
          forceRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}