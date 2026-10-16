import satori from "satori";
import { SITE } from "@/config";
import loadGoogleFonts from "../loadGoogleFont";

const MONO = "IBM Plex Mono";
const DISPLAY = "Archivo Black";

const label = text => ({
  type: "div",
  props: {
    style: {
      fontFamily: MONO,
      fontSize: 22,
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      color: "#eaeaea",
    },
    children: text,
  },
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

// Tamaño del título según su longitud, para que no se recorte de forma brusca
const titleSize = len =>
  len <= 28 ? 88 : len <= 50 ? 72 : len <= 80 ? 58 : 46;

export default async post => {
  const title = post.data.title;
  const date = new Date(post.data.pubDatetime).toISOString().slice(0, 10);
  const topLeft = "[ TOMMYCARDELO.COM ]";
  const topRight = "[ LOG / POST ]";
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
                    alignItems: "center",
                    flex: 1,
                    padding: "0 32px",
                    overflow: "hidden",
                  },
                  children: {
                    type: "div",
                    props: {
                      style: {
                        fontFamily: DISPLAY,
                        fontSize: titleSize(title.length),
                        lineHeight: 0.9,
                        letterSpacing: "-0.03em",
                        textTransform: "uppercase",
                        color: "#eaeaea",
                        maxHeight: "100%",
                        overflow: "hidden",
                      },
                      children: title,
                    },
                  },
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
                label(date),
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
        (title + by + date + topLeft + topRight).toUpperCase() + title + by
      ),
    }
  );
};
