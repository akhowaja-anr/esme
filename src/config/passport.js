import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { prisma } from "../db/prisma.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_REDIRECT_URI,
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/presentations.readonly",
      ],
      accessType: "offline",
      prompt: "consent",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log("✅ Google OAuth callback received");
        console.log("Access token:", accessToken ? "Present" : "Missing");
        
        const email = profile.emails[0].value;
        const name = profile.displayName;
        const googleId = profile.id;

        // Upsert user in database
        const user = await prisma.user.upsert({
          where: { email },
          update: {
            name,
            googleId,
            accessToken,  // ✅ Make sure this is saved
            refreshToken: refreshToken || undefined,
          },
          create: {
            email,
            name,
            googleId,
            accessToken,  // ✅ Make sure this is saved
            refreshToken: refreshToken || undefined,
          },
        });

        console.log("✅ User saved with token:", user.email);
        return done(null, user);
      } catch (error) {
        console.error("❌ Passport error:", error);
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  console.log("📝 Serializing user:", user.email);
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ 
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        googleId: true,
        accessToken: true,  // ✅ Make sure this is included
        refreshToken: true,
        slackUserId: true,
        slackAccessToken: true,
      }
    });
    
    console.log("📖 Deserialized user:", user?.email, "Has token:", !!user?.accessToken);
    done(null, user);
  } catch (error) {
    console.error("❌ Deserialize error:", error);
    done(error, null);
  }
});

export default passport;