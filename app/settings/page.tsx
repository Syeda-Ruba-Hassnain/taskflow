"use client";

import Link from "next/link";
import {
  FormEvent,
  useState,
} from "react";
import {
  signOut,
  useSession,
} from "next-auth/react";

export default function SettingsPage() {
  const {
    data: session,
    status,
    update,
  } = useSession();

  // ==================================
  // PROFILE STATE
  // ==================================

  const [isEditing, setIsEditing] =
    useState(false);

  const [name, setName] = useState("");

  const [profileError, setProfileError] =
    useState("");

  const [profileSuccess, setProfileSuccess] =
    useState("");

  const [savingProfile, setSavingProfile] =
    useState(false);

  // ==================================
  // PASSWORD STATE
  // ==================================

  const [
    isChangingPassword,
    setIsChangingPassword,
  ] = useState(false);

  const [
    currentPassword,
    setCurrentPassword,
  ] = useState("");

  const [newPassword, setNewPassword] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    passwordError,
    setPasswordError,
  ] = useState("");

  const [
    passwordSuccess,
    setPasswordSuccess,
  ] = useState("");

  const [
    changingPassword,
    setChangingPassword,
  ] = useState(false);

  // ==================================
  // DELETE ACCOUNT STATE
  // ==================================

  const [
    isDeletingAccount,
    setIsDeletingAccount,
  ] = useState(false);

  const [
    deletePassword,
    setDeletePassword,
  ] = useState("");

  const [
    deleteConfirmation,
    setDeleteConfirmation,
  ] = useState("");

  const [
    deleteError,
    setDeleteError,
  ] = useState("");

  const [
    deletingAccount,
    setDeletingAccount,
  ] = useState(false);

  // ----------------------------------
  // USER INFORMATION
  // ----------------------------------

  const userName =
    session?.user?.name?.trim() || "User";

  const userEmail =
    session?.user?.email || "";

  const initial =
    userName.charAt(0).toUpperCase();

  // ==================================
  // PROFILE
  // ==================================

  const handleEdit = () => {
    setName(userName);
    setProfileError("");
    setProfileSuccess("");
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setName(userName);
    setProfileError("");
    setIsEditing(false);
  };

  const handleSaveProfile = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setProfileError("");
    setProfileSuccess("");

    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      setProfileError(
        "Name must be at least 2 characters."
      );
      return;
    }

    if (trimmedName.length > 100) {
      setProfileError(
        "Name must be 100 characters or fewer."
      );
      return;
    }

    try {
      setSavingProfile(true);

      const response = await fetch(
        "/api/profile",
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            name: trimmedName,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Unable to update your profile."
        );
      }

      await update({
        name: data.user.name,
      });

      setName(data.user.name);
      setIsEditing(false);

      setProfileSuccess(
        "Profile updated successfully."
      );
    } catch (error) {
      console.error(
        "Profile update error:",
        error
      );

      setProfileError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSavingProfile(false);
    }
  };

  // ==================================
  // PASSWORD
  // ==================================

  const handleOpenPassword = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setPasswordSuccess("");
    setIsChangingPassword(true);
  };

  const handleCancelPassword = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setIsChangingPassword(false);
  };

  const handleChangePassword = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setPasswordError("");
    setPasswordSuccess("");

    if (!currentPassword) {
      setPasswordError(
        "Please enter your current password."
      );
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(
        "New password must be at least 8 characters."
      );
      return;
    }

    if (newPassword.length > 128) {
      setPasswordError(
        "New password must be 128 characters or fewer."
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(
        "New passwords do not match."
      );
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordError(
        "Your new password must be different from your current password."
      );
      return;
    }

    try {
      setChangingPassword(true);

      const response = await fetch(
        "/api/change-password",
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            currentPassword,
            newPassword,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Unable to change your password."
        );
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setIsChangingPassword(false);

      setPasswordSuccess(
        "Password changed successfully."
      );
    } catch (error) {
      console.error(
        "Change password error:",
        error
      );

      setPasswordError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setChangingPassword(false);
    }
  };

  // ==================================
  // DELETE ACCOUNT
  // ==================================

  const handleOpenDeleteAccount = () => {
    setDeletePassword("");
    setDeleteConfirmation("");
    setDeleteError("");
    setIsDeletingAccount(true);
  };

  const handleCancelDeleteAccount = () => {
    setDeletePassword("");
    setDeleteConfirmation("");
    setDeleteError("");
    setIsDeletingAccount(false);
  };

  const handleDeleteAccount = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    setDeleteError("");

    if (!deletePassword) {
      setDeleteError(
        "Please enter your password."
      );
      return;
    }

    if (deleteConfirmation !== "DELETE") {
      setDeleteError(
        'Please type "DELETE" to confirm.'
      );
      return;
    }

    try {
      setDeletingAccount(true);

      const response = await fetch(
        "/api/delete-account",
        {
          method: "DELETE",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            password: deletePassword,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Unable to delete your account."
        );
      }

      // Clear sensitive information.

      setDeletePassword("");
      setDeleteConfirmation("");

      // Account no longer exists, so clear
      // the Auth.js session and redirect.

      await signOut({
        redirectTo: "/register",
      });
    } catch (error) {
      console.error(
        "Delete account error:",
        error
      );

      setDeleteError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );

      setDeletingAccount(false);
    }
  };

  // ==================================
  // LOADING
  // ==================================

  if (status === "loading") {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
          <div className="animate-pulse">
            <div className="h-8 w-48 rounded bg-gray-200" />

            <div className="mt-3 h-4 w-72 max-w-full rounded bg-gray-200" />

            <div className="mt-8 h-64 rounded-2xl bg-white" />
          </div>
        </div>
      </main>
    );
  }

  // ==================================
  // PAGE
  // ==================================

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">

        {/* Back */}

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 transition hover:text-gray-900"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path
              d="M19 12H5M11 18L5 12L11 6"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          Back to dashboard
        </Link>

        {/* Header */}

        <div className="mt-6">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Account settings
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            Manage your TaskFlow profile and account
            preferences.
          </p>
        </div>

        <div className="mt-8 space-y-6">

          {/* ==================================
              PROFILE
          ================================== */}

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">

            <div className="border-b border-gray-100 px-5 py-5 sm:px-6">
              <h2 className="text-base font-semibold text-gray-900">
                Profile
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Your personal account information.
              </p>
            </div>

            <div className="p-5 sm:p-6">

              {profileSuccess && (
                <div
                  role="status"
                  className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
                >
                  {profileSuccess}
                </div>
              )}

              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">

                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xl font-bold text-white shadow-sm">
                  {initial}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="break-words text-lg font-semibold text-gray-900">
                    {userName}
                  </p>

                  <p className="mt-1 break-all text-sm text-gray-500">
                    {userEmail}
                  </p>

                  <div className="mt-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/10">
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      >
                        <path
                          d="M4 10L8 14L16 6"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>

                      Email verified
                    </span>
                  </div>
                </div>

              </div>

              <div className="my-6 border-t border-gray-100" />

              {isEditing ? (
                <form onSubmit={handleSaveProfile}>

                  <div className="max-w-lg">
                    <label
                      htmlFor="profile-name"
                      className="mb-2 block text-sm font-semibold text-gray-700"
                    >
                      Name
                    </label>

                    <input
                      id="profile-name"
                      type="text"
                      value={name}
                      disabled={savingProfile}
                      onChange={(event) => {
                        setName(event.target.value);
                        setProfileError("");
                      }}
                      autoComplete="name"
                      maxLength={100}
                      autoFocus
                      className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition focus:border-gray-500 focus:ring-4 focus:ring-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                    />

                    <p className="mt-2 text-xs text-gray-500">
                      This name will appear on your
                      TaskFlow account.
                    </p>
                  </div>

                  <div className="mt-5 max-w-lg">
                    <label
                      htmlFor="profile-email"
                      className="mb-2 block text-sm font-semibold text-gray-700"
                    >
                      Email address
                    </label>

                    <input
                      id="profile-email"
                      type="email"
                      value={userEmail}
                      disabled
                      className="min-h-12 w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 text-base text-gray-500 sm:text-sm"
                    />

                    <p className="mt-2 text-xs text-gray-500">
                      Your email address cannot be
                      changed here.
                    </p>
                  </div>

                  {profileError && (
                    <div
                      role="alert"
                      className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                    >
                      {profileError}
                    </div>
                  )}

                  <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">

                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      disabled={savingProfile}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      {savingProfile
                        ? "Saving..."
                        : "Save changes"}
                    </button>

                  </div>

                </form>
              ) : (
                <>
                  <div className="grid gap-5 sm:grid-cols-2">

                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Name
                      </p>

                      <p className="mt-1.5 break-words text-sm font-medium text-gray-800">
                        {userName}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Email address
                      </p>

                      <p className="mt-1.5 break-all text-sm font-medium text-gray-800">
                        {userEmail}
                      </p>
                    </div>

                  </div>

                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={handleEdit}
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900 sm:w-auto"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        className="h-4 w-4"
                        aria-hidden="true"
                      >
                        <path
                          d="M12 20H21"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />

                        <path
                          d="M16.5 3.5C17.3 2.7 18.7 2.7 19.5 3.5L20.5 4.5C21.3 5.3 21.3 6.7 20.5 7.5L9 19L4 20L5 15L16.5 3.5Z"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>

                      Edit profile
                    </button>
                  </div>
                </>
              )}

            </div>
          </section>

          {/* ==================================
              PASSWORD
          ================================== */}

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">

            <div className="border-b border-gray-100 px-5 py-5 sm:px-6">
              <h2 className="text-base font-semibold text-gray-900">
                Password
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                Keep your account secure by using a
                strong password.
              </p>
            </div>

            <div className="p-5 sm:p-6">

              {passwordSuccess && (
                <div
                  role="status"
                  className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
                >
                  {passwordSuccess}
                </div>
              )}

              {isChangingPassword ? (
                <form
                  onSubmit={handleChangePassword}
                  className="max-w-lg"
                >

                  <div>
                    <label
                      htmlFor="current-password"
                      className="mb-2 block text-sm font-semibold text-gray-700"
                    >
                      Current password
                    </label>

                    <input
                      id="current-password"
                      type="password"
                      value={currentPassword}
                      disabled={changingPassword}
                      onChange={(event) => {
                        setCurrentPassword(
                          event.target.value
                        );
                        setPasswordError("");
                      }}
                      placeholder="Enter your current password"
                      autoComplete="current-password"
                      required
                      autoFocus
                      className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 focus:ring-4 focus:ring-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                    />
                  </div>

                  <div className="mt-5">
                    <label
                      htmlFor="new-password"
                      className="mb-2 block text-sm font-semibold text-gray-700"
                    >
                      New password
                    </label>

                    <input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      disabled={changingPassword}
                      onChange={(event) => {
                        setNewPassword(
                          event.target.value
                        );
                        setPasswordError("");
                      }}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      required
                      className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 focus:ring-4 focus:ring-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                    />

                    <p className="mt-2 text-xs text-gray-500">
                      Use at least 8 characters.
                    </p>
                  </div>

                  <div className="mt-5">
                    <label
                      htmlFor="confirm-new-password"
                      className="mb-2 block text-sm font-semibold text-gray-700"
                    >
                      Confirm new password
                    </label>

                    <input
                      id="confirm-new-password"
                      type="password"
                      value={confirmPassword}
                      disabled={changingPassword}
                      onChange={(event) => {
                        setConfirmPassword(
                          event.target.value
                        );
                        setPasswordError("");
                      }}
                      placeholder="Enter your new password again"
                      autoComplete="new-password"
                      required
                      className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-500 focus:ring-4 focus:ring-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                    />
                  </div>

                  {passwordError && (
                    <div
                      role="alert"
                      className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
                    >
                      {passwordError}
                    </div>
                  )}

                  <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">

                    <button
                      type="button"
                      onClick={handleCancelPassword}
                      disabled={changingPassword}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      disabled={changingPassword}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      {changingPassword
                        ? "Changing password..."
                        : "Change password"}
                    </button>

                  </div>

                </form>
              ) : (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">
                      Account password
                    </p>

                    <p className="mt-1 text-sm leading-6 text-gray-500">
                      Change your password whenever
                      you need to secure your account.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenPassword}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900"
                  >
                    Change password
                  </button>

                </div>
              )}

            </div>
          </section>

          {/* ==================================
              DANGER ZONE
          ================================== */}

          <section className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm">

            <div className="border-b border-red-100 bg-red-50/50 px-5 py-5 sm:px-6">
              <h2 className="text-base font-semibold text-red-700">
                Danger zone
              </h2>

              <p className="mt-1 text-sm leading-6 text-red-600/80">
                Actions here permanently affect your
                TaskFlow account.
              </p>
            </div>

            <div className="p-5 sm:p-6">

              {isDeletingAccount ? (
                <form
                  onSubmit={handleDeleteAccount}
                  className="max-w-lg"
                >

                  {/* Warning */}

                  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <div className="flex items-start gap-3">

                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700">
                        !
                      </div>

                      <div>
                        <p className="text-sm font-semibold text-red-800">
                          This action cannot be undone
                        </p>

                        <p className="mt-1 text-sm leading-6 text-red-700">
                          Your account and all of your
                          TaskFlow tasks will be
                          permanently deleted.
                        </p>
                      </div>

                    </div>
                  </div>

                  {/* Password */}

                  <div className="mt-5">
                    <label
                      htmlFor="delete-password"
                      className="mb-2 block text-sm font-semibold text-gray-700"
                    >
                      Enter your password
                    </label>

                    <input
                      id="delete-password"
                      type="password"
                      value={deletePassword}
                      disabled={deletingAccount}
                      onChange={(event) => {
                        setDeletePassword(
                          event.target.value
                        );
                        setDeleteError("");
                      }}
                      placeholder="Your current password"
                      autoComplete="current-password"
                      required
                      autoFocus
                      className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-red-400 focus:ring-4 focus:ring-red-50 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                    />
                  </div>

                  {/* DELETE confirmation */}

                  <div className="mt-5">
                    <label
                      htmlFor="delete-confirmation"
                      className="mb-2 block text-sm font-semibold text-gray-700"
                    >
                      Type{" "}
                      <span className="font-bold text-red-600">
                        DELETE
                      </span>{" "}
                      to confirm
                    </label>

                    <input
                      id="delete-confirmation"
                      type="text"
                      value={deleteConfirmation}
                      disabled={deletingAccount}
                      onChange={(event) => {
                        setDeleteConfirmation(
                          event.target.value
                        );
                        setDeleteError("");
                      }}
                      placeholder="DELETE"
                      autoComplete="off"
                      required
                      className="min-h-12 w-full rounded-xl border border-gray-300 px-4 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-red-400 focus:ring-4 focus:ring-red-50 disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                    />

                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      This confirmation is
                      case-sensitive.
                    </p>
                  </div>

                  {/* Error */}

                  {deleteError && (
                    <div
                      role="alert"
                      className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700"
                    >
                      {deleteError}
                    </div>
                  )}

                  {/* Buttons */}

                  <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">

                    <button
                      type="button"
                      onClick={
                        handleCancelDeleteAccount
                      }
                      disabled={deletingAccount}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-300 bg-white px-5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      disabled={
                        deletingAccount ||
                        !deletePassword ||
                        deleteConfirmation !==
                          "DELETE"
                      }
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                    >
                      {deletingAccount
                        ? "Deleting account..."
                        : "Permanently delete account"}
                    </button>

                  </div>

                </form>
              ) : (
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">

                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      Delete account
                    </p>

                    <p className="mt-1 max-w-xl text-sm leading-6 text-gray-500">
                      Permanently delete your account
                      and all associated tasks. This
                      action cannot be undone.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={
                      handleOpenDeleteAccount
                    }
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                  >
                    Delete account
                  </button>

                </div>
              )}

            </div>
          </section>

        </div>
      </div>
    </main>
  );
}