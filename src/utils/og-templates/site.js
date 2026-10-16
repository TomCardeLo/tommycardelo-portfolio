import satori from "satori";
import { SITE } from "@/config";
import loadGoogleFonts from "../loadGoogleFont";

const MONO = "IBM Plex Mono";
const DISPLAY = "Archivo Black";

const mono = (extra = {}) => ({
  fontFamily: MONO,
  fontSize: 22,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "#eaeaea",
  ...extra,
});

const label = (text, extra) => ({
  type: "div",
  props: { style: mono(extra), children: text },
});

const row = (left, right, border) => ({
  type: "div",
  props: {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "18px 32px",
      ...border,
    },
    children: [left, right],
  },
});

export default async () => {
  const domain = new URL(SITE.website).hostname;
  const topLeft = "[ TOMMYCARDELO.COM ]";
  const topRight = "[ UNIT / TC-01 ]";
  const by = "BY " + SITE.author;

  return satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0a0a0a",
          padding: 40,
        },
        children: {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              width: "100%",
              height: "100%",
              border: "2px solid #eaeaea",
            },
            children: [
              row(label(topLeft), label(topRight), {
                borderBottom: "1px solid #333",
              }),
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    flex: 1,
                    padding: "0 32px",
                    overflow: "hidden",
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          fontFamily: DISPLAY,
                          fontSize: 130,
                          lineHeight: 0.9,
                          letterSpacing: "-0.03em",
                          textTransform: "uppercase",
                          color: "#eaeaea",
                        },
                        children: SITE.title,
                      },
                    },
                    label(">>> " + SITE.desc, {
                      color: "#ff2a2a",
                      fontSize: 22,
                      marginTop: 28,
                    }),
                  ],
                },
              },
              row(
                {
                  type: "div",
                  props: {
                    style: { display: "flex", alignItems: "center" },
                    children: [
                      {
                        type: "div",
                        props: {
                          style: {
                            width: 24,
                            height: 24,
                            background: "#ff2a2a",
                            marginRight: 18,
                          },
                        },
                      },
                      label(by),
                    ],
                  },
                },
                label(domain),
                { borderTop: "1px solid #333" }
              ),
            ],
          },
        },
      },
    },
    {
      width: 1200,
      height: 630,
      embedFont: true,
      fonts: await loadGoogleFonts(
        (
          SITE.title +
          SITE.desc +
          by +
          domain +
          topLeft +
          topRight +
          ">>> "
        ).toUpperCase() +
          SITE.title +
          SITE.desc
      ),
    }
  );
};
